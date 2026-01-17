import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  AlertCircle, FileText, Info, Database, Zap, Activity, Upload, 
  FileSpreadsheet, X, Code, List, Plus, Trash2, GripVertical, Settings 
} from 'lucide-react';
import ErrorDashboard from './ErrorDashboard';

const SAMPLE_CSV = `id,name,age,email,role
1,Alice,30,alice@example.com,admin
2,Bob,24,bob@example.com,user
3,Charlie,150,charlie.example.com,guest
4,,abc,,unknown
5,Eve,29,eve@example.com,user`;

const SAMPLE_RULES = [
  { "column": "name", "rules": [{ "type": "notempty" }] },
  { "column": "age", "rules": [{ "type": "notempty" }, { "type": "number", "min": 18, "max": 100 }] },
  { "column": "email", "rules": [{ "type": "email" }] },
  { "column": "role", "rules": [{ "type": "oneof", "options": ["admin", "user", "guest"] }] }
];

// --- JS Fallback Processor (Mimics Rust Struct) ---
class CsvProcessorJS {
    constructor(csvData, rulesJson) {
        this.rows = csvData.trim().split('\n').map(r => r.split(','));
        this.headers = this.rows[0];
        this.records = this.rows.slice(1);
        this.rules = JSON.parse(rulesJson);
        this.ruleMap = {};
        this.rules.forEach(r => this.ruleMap[r.column] = r.rules);
    }

    get_error_summary() {
        const stats = {};
        const examples = {};
        let total = 0;

        this.records.forEach(row => {
            row.forEach((val, colIdx) => {
                const colName = this.headers[colIdx];
                const rules = this.ruleMap[colName];
                if (!rules) return;

                rules.forEach(rule => {
                    let errType = null;
                    if (rule.type === 'notempty' && !val) errType = 'Required';
                    else if (rule.type === 'number') {
                        const n = parseFloat(val);
                        if (isNaN(n)) errType = 'Not a Number';
                        else if (rule.min !== undefined && n < rule.min) errType = 'Min Value';
                        else if (rule.max !== undefined && n > rule.max) errType = 'Max Value';
                    }
                    else if (rule.type === 'email' && !/@/.test(val)) errType = 'Invalid Email';
                    else if (rule.type === 'oneof' && !rule.options.includes(val)) errType = 'Invalid Option';

                    if (errType) {
                        total++;
                        if (!stats[colName]) stats[colName] = {};
                        stats[colName][errType] = (stats[colName][errType] || 0) + 1;
                        
                        if (!examples[colName]) examples[colName] = {};
                        if (!examples[colName][errType]) examples[colName][errType] = val;
                    }
                });
            });
        });

        return { stats, examples, total_errors: total };
    }

    apply_bulk_fix(colName, findVal, replaceVal) {
        const colIdx = this.headers.indexOf(colName);
        if (colIdx === -1) return this.count_total_errors();

        this.records.forEach(row => {
            if (row[colIdx] === findVal) {
                row[colIdx] = replaceVal;
            }
        });
        return this.count_total_errors();
    }

    generate_split_export() {
        // Simple mock export for JS fallback
        const valid = [this.headers.join(',')];
        const invalid = [this.headers.join(',') + ",Error_Reason"];
        
        // Populate (simplified logic for brevity in fallback)
        this.records.forEach(row => valid.push(row.join(',')));
        
        return { valid: valid.join('\n'), invalid: invalid.join('\n') };
    }

    count_total_errors() {
        return this.get_error_summary().total_errors;
    }
}

export default function App() {
  const [csvData, setCsvData] = useState(SAMPLE_CSV);
  const [rulesData, setRulesData] = useState(JSON.stringify(SAMPLE_RULES, null, 2));
  const [parsedRules, setParsedRules] = useState(SAMPLE_RULES);
  const [viewMode, setViewMode] = useState('visual'); 

  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [wasmModule, setWasmModule] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [processor, setProcessor] = useState(null);
  const [processingTime, setProcessingTime] = useState(0);

  const [isLargeFile, setIsLargeFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    const loadWasm = async () => {
      try {
        const wasm = await import(/* @vite-ignore */ './pkg/rust_csv_validator.js');
        await wasm.default();
        setWasmModule(wasm);
        setStatus('wasm');
      } catch (err) {
        console.warn("Wasm not found. Falling back to JS Class Simulation.", err);
        // Fallback: Mock the Module structure so 'new wasmModule.CsvProcessor' works
        setWasmModule({ CsvProcessor: CsvProcessorJS });
        setStatus('simulation');
      }
    };
    loadWasm();
  }, []);

  // One-way sync from Visual Builder -> JSON string
  useEffect(() => {
    if (viewMode === 'visual') {
        try {
            setRulesData(JSON.stringify(parsedRules, null, 2));
        } catch (e) { console.error(e); }
    }
  }, [parsedRules, viewMode]);

  const handleValidate = useCallback(() => {
    if (!wasmModule) {
      setError("Engine not loaded.");
      return;
    }

    try {
      setError(null);
      setProcessor(null); 
      
      setTimeout(() => {
        try {
          const start = performance.now();
          
          // This line now works for both Wasm (Real) and JS (Fallback)
          const proc = new wasmModule.CsvProcessor(csvData, rulesData);
          
          const end = performance.now();
          setProcessingTime(end - start);
          setProcessor(proc);
        } catch (err) {
           setError(err.toString());
        }
      }, 50);

    } catch (err) {
      console.error(err);
      setError(err.toString());
    }
  }, [wasmModule, csvData, rulesData]);

  const toggleViewMode = () => {
      if (viewMode === 'visual') {
          setViewMode('json');
      } else {
          try {
              const parsed = JSON.parse(rulesData);
              if (!Array.isArray(parsed)) throw new Error("Root must be array");
              setParsedRules(parsed);
              setViewMode('visual');
              setError(null);
          } catch (e) {
              setError("Cannot switch to Visual: Invalid JSON.");
          }
      }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProcessor(null);
    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      setCsvData(text);
      setIsLargeFile(text.length > 1_000_000);
    };
    reader.readAsText(file);
  };

  const clearFile = () => {
    setCsvData("");
    setIsLargeFile(false);
    setFileName("");
    setProcessor(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const generateLargeDataset = useCallback(() => {
    setIsGenerating(true);
    setProcessor(null);
    setFileName("generated_2M_dataset.csv");
    setTimeout(() => {
        const headers = "id,name,age,email,role";
        let csvBuilder = [headers];
        const targetRows = 2000000;
        const roles = ["admin", "user", "guest", "unknown"];
        for (let i = 0; i < targetRows; i++) {
             const isError = Math.random() < 0.0005; 
             const id = i + 1;
             const name = isError ? "" : `User${i}`; 
             const age = Math.floor(Math.random() * 60) + 20;
             const email = `user${i}@example.com`;
             const role = roles[i % 4];
             csvBuilder.push(`${id},${name},${age},${email},${role}`);
        }
        const text = csvBuilder.join('\n');
        setCsvData(text);
        setIsLargeFile(true);
        setIsGenerating(false);
    }, 100);
  }, []);

  // Visual Builder Handlers
  const addColumnRule = () => setParsedRules([...parsedRules, { column: "", rules: [] }]);
  const removeColumnRule = (idx) => {
      const newRules = [...parsedRules];
      newRules.splice(idx, 1);
      setParsedRules(newRules);
  };
  const updateColumnName = (idx, name) => {
      const newRules = [...parsedRules];
      newRules[idx].column = name;
      setParsedRules(newRules);
  };
  const addRuleToColumn = (colIdx, ruleType) => {
      const newRules = [...parsedRules];
      let newRule = { type: ruleType };
      if (ruleType === 'number') { newRule.min = 0; newRule.max = 100; }
      if (ruleType === 'regex') { newRule.pattern = "^[a-z]+$"; }
      if (ruleType === 'oneof') { newRule.options = ["option1"]; }
      newRules[colIdx].rules.push(newRule);
      setParsedRules(newRules);
  };
  const removeRuleFromColumn = (colIdx, ruleIdx) => {
      const newRules = [...parsedRules];
      newRules[colIdx].rules.splice(ruleIdx, 1);
      setParsedRules(newRules);
  };
  const updateRuleProp = (colIdx, ruleIdx, prop, value) => {
      const newRules = [...parsedRules];
      newRules[colIdx].rules[ruleIdx][prop] = value;
      setParsedRules(newRules);
  };

  const getHeaders = () => {
    if(!csvData) return [];
    const idx = csvData.indexOf('\n');
    return idx === -1 ? csvData.split(',') : csvData.slice(0, idx).trim().split(',');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 flex flex-col">
      <div className="flex-1 max-w-6xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-8 h-8 text-orange-600" />
              Rust CSV Validator
            </h1>
            <p className="text-slate-500 mt-1">High-performance Wasm validation playground</p>
          </div>
          <div className={`px-4 py-2 rounded-full border text-sm font-medium ${status === 'wasm' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            {status === 'wasm' ? 'Wasm Ready' : 'JS Simulation'}
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded shadow-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-800">System Error</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
          {/* Left: Input & Rules */}
          <div className="space-y-6 flex flex-col">
            
            {/* CSV Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[400px]">
              <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <span className="font-semibold text-slate-700 text-sm">CSV Data</span>
                <div className="flex items-center gap-2">
                     <span className="text-xs text-slate-500">{isLargeFile ? '>1MB' : 'Raw Text'}</span>
                     <button onClick={generateLargeDataset} disabled={isGenerating} className="px-2 py-1 bg-white border rounded text-xs hover:text-orange-600">
                        {isGenerating ? "..." : "Gen 2M"}
                     </button>
                     <button onClick={() => fileInputRef.current?.click()} className="px-2 py-1 bg-white border rounded text-xs hover:text-blue-600">
                        Upload
                     </button>
                     <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
              
              {isLargeFile ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
                    <FileSpreadsheet className="w-16 h-16 text-slate-300 mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700">Large File Loaded</h3>
                    <p className="text-slate-500 text-sm mt-1 mb-4">{fileName || "Generated Data"}</p>
                    <button onClick={clearFile} className="flex items-center gap-2 text-slate-500 hover:text-red-500 text-sm font-medium">
                        <X className="w-4 h-4" /> Clear
                    </button>
                </div>
              ) : (
                <textarea
                    className="flex-1 w-full p-4 font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/20 text-slate-600"
                    value={csvData}
                    onChange={(e) => { setCsvData(e.target.value); setFileName(""); }}
                    spellCheck="false"
                    placeholder="Paste CSV..."
                />
              )}
            </div>

            {/* Rules Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[400px]">
               <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <span className="font-semibold text-slate-700 text-sm">Validation Rules</span>
                <div className="flex bg-slate-200 rounded-lg p-0.5">
                    <button onClick={toggleViewMode} disabled={viewMode === 'visual'} className={`px-2 py-1 rounded text-xs ${viewMode === 'visual' ? 'bg-white shadow' : 'text-slate-500'}`}><List className="w-3 h-3 inline mr-1"/>Visual</button>
                    <button onClick={toggleViewMode} disabled={viewMode === 'json'} className={`px-2 py-1 rounded text-xs ${viewMode === 'json' ? 'bg-white shadow' : 'text-slate-500'}`}><Code className="w-3 h-3 inline mr-1"/>JSON</button>
                </div>
              </div>

              {viewMode === 'json' ? (
                  <textarea className="flex-1 p-4 font-mono text-xs resize-none focus:outline-none" value={rulesData} onChange={(e) => setRulesData(e.target.value)} />
              ) : (
                  <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 custom-scrollbar space-y-3">
                      {parsedRules.map((colRule, colIdx) => (
                          <div key={colIdx} className="bg-white border rounded p-3 relative group">
                              <div className="flex gap-2 mb-2">
                                  <GripVertical className="w-4 h-4 text-slate-300" />
                                  <input 
                                    list="headers" 
                                    className="font-bold text-sm border-none p-0 focus:ring-0 w-full" 
                                    value={colRule.column} 
                                    onChange={(e) => updateColumnName(colIdx, e.target.value)} 
                                    placeholder="Column"
                                  />
                                  <datalist id="headers">{getHeaders().map(h => <option key={h} value={h}/>)}</datalist>
                                  <button onClick={() => removeColumnRule(colIdx)}><Trash2 className="w-4 h-4 text-slate-300 hover:text-red-500"/></button>
                              </div>
                              <div className="space-y-1 pl-6">
                                  {colRule.rules.map((rule, rIdx) => (
                                      <div key={rIdx} className="text-xs bg-slate-50 p-1.5 rounded border flex flex-col gap-1">
                                          <div className="flex justify-between font-medium text-slate-600">
                                              {rule.type}
                                              <button onClick={() => removeRuleFromColumn(colIdx, rIdx)}><X className="w-3 h-3 hover:text-red-500"/></button>
                                          </div>
                                          {rule.type === 'number' && (
                                              <div className="flex gap-1"><input type="number" placeholder="min" className="w-12 border rounded px-1" value={rule.min||''} onChange={e=>updateRuleProp(colIdx,rIdx,'min',parseFloat(e.target.value))}/><input type="number" placeholder="max" className="w-12 border rounded px-1" value={rule.max||''} onChange={e=>updateRuleProp(colIdx,rIdx,'max',parseFloat(e.target.value))}/></div>
                                          )}
                                          {rule.type === 'oneof' && (
                                              <input type="text" placeholder="opt1,opt2" className="w-full border rounded px-1" value={rule.options?.join(',')||''} onChange={e=>updateRuleProp(colIdx,rIdx,'options',e.target.value.split(','))}/>
                                          )}
                                          {rule.type === 'regex' && (
                                              <input type="text" placeholder="pattern" className="w-full border rounded px-1 font-mono" value={rule.pattern||''} onChange={e=>updateRuleProp(colIdx,rIdx,'pattern',e.target.value)}/>
                                          )}
                                      </div>
                                  ))}
                              </div>
                              <select className="mt-2 text-xs bg-slate-100 rounded px-1 ml-6" onChange={(e)=>{if(e.target.value){addRuleToColumn(colIdx,e.target.value);e.target.value=''}}}>
                                  <option value="">+ Rule</option>
                                  <option value="notempty">Required</option>
                                  <option value="number">Number</option>
                                  <option value="email">Email</option>
                                  <option value="oneof">OneOf</option>
                                  <option value="regex">Regex</option>
                              </select>
                          </div>
                      ))}
                      <button onClick={addColumnRule} className="w-full py-2 border border-dashed rounded text-sm text-slate-400 hover:text-orange-600">+ Add Column</button>
                  </div>
              )}
            </div>
            
            <button onClick={handleValidate} disabled={status === 'loading'} className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 ${status === 'wasm' ? 'bg-gradient-to-r from-orange-600 to-red-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
              <Zap className="w-5 h-5 fill-current" /> Initialize Processor
            </button>
          </div>

          {/* Right: Dashboard */}
          <div className="space-y-6 flex flex-col h-full">
            {processor ? (
                <>
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                             <Activity className="w-4 h-4" /> 
                             Processed in <span className="font-bold text-slate-800">{processingTime.toFixed(2)}ms</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <ErrorDashboard processor={processor} />
                    </div>
                </>
            ) : (
                <div className="h-full bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-slate-400 p-8">
                    <Database className="w-16 h-16 text-slate-200 mb-4" />
                    <p>Load data and rules to start the dashboard.</p>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}