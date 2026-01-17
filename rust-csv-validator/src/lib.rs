use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use regex::Regex;

// --- Data Structures ---

#[derive(Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RuleType {
    NotEmpty,
    Number { min: Option<f64>, max: Option<f64> },
    Email,
    Regex { pattern: String },
    OneOf { options: Vec<String> },
}

#[derive(Deserialize, Clone)]
pub struct ColumnRule {
    pub column: String,
    pub rules: Vec<RuleType>,
}

#[derive(Serialize)]
pub struct ErrorSummary {
    // column_name -> { error_type -> count }
    pub stats: HashMap<String, HashMap<String, usize>>,
    // column_name -> { error_type -> example_value }
    pub examples: HashMap<String, HashMap<String, String>>,
    pub total_errors: usize,
}

// --- The Stateful Processor ---

#[wasm_bindgen]
pub struct CsvProcessor {
    headers: Vec<String>,
    records: Vec<Vec<String>>, 
    rules: Vec<ColumnRule>,
    rule_map: HashMap<String, Vec<RuleType>>,
}

#[wasm_bindgen]
impl CsvProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(csv_data: &str, rules_json: &str) -> Result<CsvProcessor, JsValue> {
        let rules: Vec<ColumnRule> = serde_json::from_str(rules_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid Rules JSON: {}", e)))?;

        let mut rule_map = HashMap::new();
        for r in &rules {
            rule_map.insert(r.column.clone(), r.rules.clone());
        }

        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(csv_data.as_bytes());

        let headers = reader
            .headers()
            .map_err(|e| JsValue::from_str(&format!("Header Error: {}", e)))?
            .iter()
            .map(|h| h.to_string())
            .collect();

        let mut records = Vec::new();
        for result in reader.records() {
            let record = result.map_err(|e| JsValue::from_str(&format!("CSV Parse Error: {}", e)))?;
            records.push(record.iter().map(|s| s.to_string()).collect());
        }

        Ok(CsvProcessor {
            headers,
            records,
            rules,
            rule_map,
        })
    }

    pub fn get_error_summary(&self) -> Result<JsValue, JsValue> {
        let mut stats: HashMap<String, HashMap<String, usize>> = HashMap::new();
        let mut examples: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut total_errors = 0;

        let email_regex = Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap();

        for record in self.records.iter() {
            for (col_idx, value) in record.iter().enumerate() {
                if let Some(col_name) = self.headers.get(col_idx) {
                    if let Some(rules) = self.rule_map.get(col_name) {
                        for rule in rules {
                            let error_type = match rule {
                                RuleType::NotEmpty => if value.trim().is_empty() { Some("Required") } else { None },
                                RuleType::Number { min, max } => {
                                    match value.parse::<f64>() {
                                        Ok(num) => {
                                            if min.map_or(false, |m| num < m) { Some("Min Value") }
                                            else if max.map_or(false, |m| num > m) { Some("Max Value") }
                                            else { None }
                                        },
                                        Err(_) => Some("Not a Number")
                                    }
                                },
                                RuleType::Email => if !email_regex.is_match(value) { Some("Invalid Email") } else { None },
                                RuleType::Regex { pattern } => {
                                     if let Ok(re) = Regex::new(pattern) {
                                         if !re.is_match(value) { Some("Pattern Mismatch") } else { None }
                                     } else { None }
                                },
                                RuleType::OneOf { options } => if !options.contains(value) { Some("Invalid Option") } else { None },
                            };

                            if let Some(etype) = error_type {
                                total_errors += 1;
                                let col_stats = stats.entry(col_name.clone()).or_insert_with(HashMap::new);
                                *col_stats.entry(etype.to_string()).or_insert(0) += 1;

                                // Only save the first example for this error type
                                let col_examples = examples.entry(col_name.clone()).or_insert_with(HashMap::new);
                                col_examples.entry(etype.to_string()).or_insert(value.clone());
                            }
                        }
                    }
                }
            }
        }

        let summary = ErrorSummary { stats, examples, total_errors };
        //New: Use json_compatible() to force HashMaps into Objects
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        Ok(summary.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
    }

    pub fn apply_bulk_fix(&mut self, col_name: &str, target_val: &str, replace_val: &str) -> usize {
        let col_idx = self.headers.iter().position(|h| h == col_name);
        
        if let Some(idx) = col_idx {
            for record in &mut self.records {
                if let Some(val) = record.get_mut(idx) {
                    if val == target_val {
                        *val = replace_val.to_string();
                    }
                }
            }
        }
        self.count_total_errors()
    }

    pub fn generate_split_export(&self) -> Result<JsValue, JsValue> {
        let mut valid_wtr = csv::Writer::from_writer(vec![]);
        let mut invalid_wtr = csv::Writer::from_writer(vec![]);

        let mut invalid_headers = self.headers.clone();
        invalid_headers.push("Error_Reason".to_string());
        
        valid_wtr.write_record(&self.headers).map_err(|e| JsValue::from_str(&e.to_string()))?;
        invalid_wtr.write_record(&invalid_headers).map_err(|e| JsValue::from_str(&e.to_string()))?;

        let email_regex = Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap();

        for record in &self.records {
            let mut row_errors = Vec::new();
            for (col_idx, value) in record.iter().enumerate() {
                if let Some(col_name) = self.headers.get(col_idx) {
                    if let Some(rules) = self.rule_map.get(col_name) {
                        for rule in rules {
                             let is_err = match rule {
                                RuleType::NotEmpty => value.trim().is_empty(),
                                RuleType::Number { min, max } => {
                                    match value.parse::<f64>() {
                                        Ok(num) => min.map_or(false, |m| num < m) || max.map_or(false, |m| num > m),
                                        Err(_) => true
                                    }
                                },
                                RuleType::Email => !email_regex.is_match(value),
                                RuleType::Regex { pattern } => Regex::new(pattern).map_or(false, |re| !re.is_match(value)),
                                RuleType::OneOf { options } => !options.contains(value),
                            };
                            if is_err {
                                row_errors.push(format!("{}: Invalid", col_name));
                            }
                        }
                    }
                }
            }

            if row_errors.is_empty() {
                valid_wtr.write_record(record).map_err(|e| JsValue::from_str(&e.to_string()))?;
            } else {
                let mut dirty_row = record.clone();
                dirty_row.push(row_errors.join("; "));
                invalid_wtr.write_record(&dirty_row).map_err(|e| JsValue::from_str(&e.to_string()))?;
            }
        }

        let valid_csv = String::from_utf8(valid_wtr.into_inner().unwrap()).unwrap();
        let invalid_csv = String::from_utf8(invalid_wtr.into_inner().unwrap()).unwrap();

        let result = serde_json::json!({
            "valid": valid_csv,
            "invalid": invalid_csv
        });

        Ok(serde_wasm_bindgen::to_value(&result)?)
    }

    fn count_total_errors(&self) -> usize {
        let mut count = 0;
        let email_regex = Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap();

        for record in &self.records {
            for (col_idx, value) in record.iter().enumerate() {
                if let Some(col_name) = self.headers.get(col_idx) {
                    if let Some(rules) = self.rule_map.get(col_name) {
                        for rule in rules {
                             let is_err = match rule {
                                RuleType::NotEmpty => value.trim().is_empty(),
                                RuleType::Number { min, max } => {
                                    match value.parse::<f64>() {
                                        Ok(num) => min.map_or(false, |m| num < m) || max.map_or(false, |m| num > m),
                                        Err(_) => true
                                    }
                                },
                                RuleType::Email => !email_regex.is_match(value),
                                RuleType::Regex { pattern } => Regex::new(pattern).map_or(false, |re| !re.is_match(value)),
                                RuleType::OneOf { options } => !options.contains(value),
                            };
                            if is_err { count += 1; }
                        }
                    }
                }
            }
        }
        count
    }
}