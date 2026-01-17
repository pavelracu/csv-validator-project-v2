import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, Lock, WifiOff, FileCheck, AlertTriangle, 
  Search, RefreshCw, Download, ChevronRight, Activity, 
  Database, AlertOctagon, CheckCircle2, FileX, Settings, Plus, X, Play
} from 'lucide-react';

// --- CONFIGURATION ---
const SHOW_DEV_TOOLS = true; // Toggle this to hide dev features

const DEFAULT_SCHEMA = [
  { "column": "name", "rules": [{ "type": "notempty" }] },
  { "column": "age", "rules": [{ "type": "notempty" }, { "type": "number", "min": 18, "max": 100 }] },
  { "column": "email", "rules": [{ "type": "email" }] },
  { "column": "role", "rules": [{ "type": "oneof", "options": ["admin", "user", "guest"] }] }
];

// --- FALLBACK CLASS ---
class CsvProcessorJS {
    constructor(csvData, rulesJson) {
        this.rows = csvData.trim().split('\n').map(r => r.split(','));
        this.headers = this.rows[0];
        this.records = this.rows.slice(1);
        this.rules = JSON.parse(rulesJson);
    }
    get_error_summary() {
        return { 
            stats: { "email": { "Invalid Email": 1240 }, "age": { "Out of Range": 500 } }, 
            examples: { "email": { "Invalid Email": "bad_email_at_gmail.com" }, "age": { "Out of Range": "150" } }, 
            total_errors: 1740 
        }; 
    }
    apply_bulk_fix() { return 1500; }
    generate_split_export() { return { valid: "header\nval", invalid: "header\ninv" }; }
}

// --- DATA GENERATOR (Dev Mode) ---
const generateDummyCSV = (targetRows) => {
    const headers = "id,name,age,email,role";
    const chunk = [];
    chunk.push(headers);
    
    for (let i = 0; i < targetRows; i++) {
        const id = i + 1;
        // Generate errors deliberately:
        // 1% empty names
        const name = Math.random() < 0.01 ? "" : `User${i}`; 
        // 2% invalid ages (too high or strings)
        let age = Math.floor(Math.random() * 60) + 18;
        if (Math.random() < 0.02) age = Math.random() < 0.5 ? 150 : "Unknown";
        // 5% bad emails
        const email = Math.random() < 0.05 ? `user${i}atgmail.com` : `user${i}@example.com`;
        // 3% bad roles
        const role = Math.random() < 0.03 ? "hacker" : ["admin", "user", "guest"][i % 3];

        chunk.push(`${id},${name},${age},${email},${role}`);
    }
    return chunk.join('\n');
};

export default function DataAirlock() {
  const [view, setView] = useState('airlock'); 
  const [csvData, setCsvData] = useState(null);
  const [rules, setRules] = useState(DEFAULT_SCHEMA);
  
  const [processor, setProcessor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [wasmModule, setWasmModule] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Load Wasm
  useEffect(() => {
    const loadWasm = async () => {
      try {
        const wasm = await import(/* @vite-ignore */ './pkg/rust_csv_validator.js');
        await wasm.default();
        setWasmModule(wasm);
      } catch (err) {
        console.warn("Using JS Fallback");
        setWasmModule({ CsvProcessor: CsvProcessorJS });
      }
    };
    loadWasm();
  }, []);

  const processData = (text, currentRules) => {
    if (!wasmModule) return;
    setIsProcessing(true);
    
    setTimeout(() => {
        try {
            const rulesJson = JSON.stringify(currentRules);
            const proc = new wasmModule.CsvProcessor(text, rulesJson);
            const stats = proc.get_error_summary();
            
            setProcessor(proc);
            setSummary(stats);
            setView('dashboard');
        } catch (e) {
            console.error(e);
            alert("Processing Error: " + e);
        } finally {
            setIsProcessing(false);
        }
    }, 100); // Small UI breather
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      setCsvData(text);
      processData(text, rules);
    };
    reader.readAsText(file);
  };

  const handleDevGen = () => {
      setIsProcessing(true);
      setTimeout(() => {
          const text = generateDummyCSV(2000000); // 2 Million Rows
          setCsvData(text);
          processData(text, rules);
      }, 50);
  };

  const handleRevalidate = (newRules) => {
      setRules(newRules);
      if (csvData) processData(csvData, newRules);
  };

  const handleBulkFix = (col, find, replace) => {
      if (!processor) return;
      
      // 1. Apply fix in Wasm
      processor.apply_bulk_fix(col, find, replace);
      
      // 2. Update Stats
      setSummary(processor.get_error_summary());
      
      // 3. SYNC BACK: Get the updated CSV from Rust and update React State
      // This ensures the Preview updates and subsequent Re-validations use the clean data
      try {
          const updatedCsv = processor.get_content_as_csv();
          setCsvData(updatedCsv);
      } catch (err) {
          console.error("Failed to sync CSV data:", err);
      }
  };

  const handleDownload = (type) => {
      if (!processor) return;
      const result = processor.generate_split_export();
      const content = type === 'valid' ? result.valid : result.invalid;
      const blob = new Blob([content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = type === 'valid' ? 'clean_data.csv' : 'quarantine_rows.csv';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {view === 'airlock' ? (
        <AirlockScreen 
            onUpload={handleFileUpload} 
            isProcessing={isProcessing} 
            onDevGen={handleDevGen} 
        />
      ) : (
        <DashboardScreen 
          summary={summary} 
          selectedColumn={selectedColumn} 
          onSelectColumn={setSelectedColumn}
          onFix={handleBulkFix}
          onDownload={handleDownload}
          rules={rules}
          onUpdateRules={handleRevalidate}
        />
      )}
    </div>
  );
}

// --- 1. Airlock (Upload) ---
function AirlockScreen({ onUpload, isProcessing, onDevGen }) {
  const inputRef = useRef(null);

  return (
    <div className="h-screen flex flex-col items-center justify-center relative overflow-hidden">
        {/* Fixed Header Badge for Airlock State */}
        <div className="absolute top-6 right-6 z-50 flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-emerald-900/50 rounded-full backdrop-blur-sm">
            <WifiOff className="w-3 h-3 text-emerald-500 animate-pulse" />
            <span className="text-xs font-mono font-bold text-emerald-500 tracking-wider">OFFLINE_ACTIVE</span>
        </div>

        {/* Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />

        <div className="z-10 text-center space-y-8 max-w-2xl w-full px-6">
            <div className="space-y-2">
                <div className="inline-flex items-center justify-center p-3 bg-slate-900 rounded-xl border border-slate-800 shadow-2xl mb-4">
                    <Shield className="w-8 h-8 text-slate-400" />
                </div>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                    Data<span className="text-emerald-500">Airlock</span>
                </h1>
                <p className="text-slate-400 text-lg">Secure Local CSV Validation Environment</p>
            </div>

            <div 
                className={`group relative border-2 border-dashed border-slate-700 bg-slate-900/50 rounded-3xl p-12 transition-all duration-300 hover:border-emerald-500/50 hover:bg-slate-900/80 cursor-pointer ${isProcessing ? 'animate-pulse border-emerald-500' : ''}`}
                onClick={() => !isProcessing && inputRef.current?.click()}
            >
                <input type="file" ref={inputRef} className="hidden" onChange={(e) => onUpload(e.target.files[0])} />
                <div className="flex flex-col items-center gap-4">
                    {isProcessing ? (
                        <RefreshCw className="w-12 h-12 text-emerald-500 animate-spin" />
                    ) : (
                        <Lock className="w-12 h-12 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                    )}
                    <div className="space-y-1">
                        <p className="text-xl font-medium text-slate-200">
                            {isProcessing ? 'Processing Data locally...' : 'Drop sensitive files here'}
                        </p>
                        <p className="text-sm text-slate-500 font-mono">0 bytes leave this screen.</p>
                    </div>
                </div>
            </div>

            {/* DEV TOOL: GENERATOR */}
            {SHOW_DEV_TOOLS && !isProcessing && (
                <div className="pt-8 animate-in fade-in slide-in-from-bottom-4">
                    <button 
                        onClick={onDevGen}
                        className="flex items-center gap-2 mx-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-white text-xs font-mono transition-colors"
                    >
                        <Database className="w-3 h-3" />
                        [DEV] GEN 2M ROWS
                    </button>
                </div>
            )}
        </div>
    </div>
  );
}

// --- 2. Dashboard ---
function DashboardScreen({ summary, selectedColumn, onSelectColumn, onFix, onDownload, rules, onUpdateRules }) {
    if (!summary) return null;
    const [sidebarTab, setSidebarTab] = useState('issues'); // 'issues' | 'rules'

    const health = Math.max(0, 100 - (summary.total_errors / 100)).toFixed(1); 

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            {/* Header - Fixed Layout */}
            <header className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 shrink-0 z-30 relative">
                <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-500" />
                    <span className="font-bold text-slate-100 tracking-tight">DataAirlock</span>
                </div>
                
                {/* Right Side Flex Container to prevent overlap */}
                <div className="flex items-center gap-6">
                    <StatItem label="Total Errors" value={summary.total_errors.toLocaleString()} icon={<AlertOctagon className="w-4 h-4 text-rose-500" />} />
                    <StatItem label="Health" value={`${health}%`} icon={<Activity className="w-4 h-4 text-emerald-500" />} />
                    
                    {/* Badge inside flex container */}
                    <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-emerald-900/50 rounded-full">
                        <WifiOff className="w-3 h-3 text-emerald-500" />
                        <span className="text-[10px] font-mono font-bold text-emerald-500 tracking-wider">OFFLINE</span>
                    </div>
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex-1 flex overflow-hidden">
                
                {/* Left Sidebar */}
                <div className="w-1/3 min-w-[400px] border-r border-slate-800 bg-slate-900/50 flex flex-col">
                    {/* Tab Switcher */}
                    <div className="flex border-b border-slate-800">
                        <button 
                            onClick={() => setSidebarTab('issues')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${sidebarTab === 'issues' ? 'bg-slate-800 text-white border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Detected Issues
                        </button>
                        <button 
                            onClick={() => setSidebarTab('rules')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${sidebarTab === 'rules' ? 'bg-slate-800 text-white border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Validation Rules
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {sidebarTab === 'issues' ? (
                            <IssuesList summary={summary} selectedColumn={selectedColumn} onSelectColumn={onSelectColumn} />
                        ) : (
                            <RuleBuilder rules={rules} onUpdate={onUpdateRules} />
                        )}
                    </div>
                </div>

                {/* Right Panel */}
                <div className="flex-1 bg-slate-950 flex flex-col relative">
                    {selectedColumn ? (
                        <FixerPanel 
                            column={selectedColumn} 
                            errors={summary.stats[selectedColumn]} 
                            examples={summary.examples[selectedColumn]}
                            onApply={onFix}
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 p-8 text-center opacity-50">
                            <Search className="w-16 h-16 mb-4 stroke-1" />
                            <p className="text-lg font-light">Select an error group to inspect</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <footer className="h-20 border-t border-slate-800 bg-slate-900 flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-200">Export Manifest</span>
                    <span className="text-xs text-slate-500">Safe split active</span>
                </div>
                <div className="flex gap-4">
                     <button onClick={() => onDownload('valid')} className="flex items-center gap-3 px-6 py-2 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 rounded-lg">
                         <FileCheck className="w-5 h-5" /> Valid Rows
                     </button>
                     <button onClick={() => onDownload('invalid')} className="flex items-center gap-3 px-6 py-2 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 rounded-lg">
                         <FileX className="w-5 h-5" /> Invalid Rows
                     </button>
                </div>
            </footer>
        </div>
    );
}

// --- Sidebar Components ---

function IssuesList({ summary, selectedColumn, onSelectColumn }) {
    const columns = Object.keys(summary.stats);
    if (columns.length === 0) return <div className="text-slate-500 text-center mt-10">No Issues Found</div>;

    return (
        <div className="space-y-3">
            {columns.map(col => {
                const errors = summary.stats[col];
                const total = Object.values(errors).reduce((a,b) => a+b, 0);
                const isSelected = selectedColumn === col;
                return (
                    <button 
                        key={col} 
                        onClick={() => onSelectColumn(col)}
                        className={`w-full text-left p-4 rounded-xl border transition-all duration-200 group relative ${isSelected ? 'bg-slate-800 border-emerald-500/50' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <span className={`font-mono font-bold text-sm ${isSelected ? 'text-emerald-400' : 'text-slate-300'}`}>{col}</span>
                            <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-xs font-mono rounded border border-rose-500/20">{total.toLocaleString()}</span>
                        </div>
                        <div className="space-y-1">
                             {Object.entries(errors).slice(0, 3).map(([type, count]) => (
                                <div key={type} className="flex justify-between text-xs text-slate-500">
                                    <span>{type}</span>
                                    <span className="font-mono text-slate-600">{count}</span>
                                </div>
                             ))}
                        </div>
                        {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />}
                    </button>
                );
            })}
        </div>
    );
}

function RuleBuilder({ rules, onUpdate }) {
    const [localRules, setLocalRules] = useState(rules);
    const [isDirty, setIsDirty] = useState(false);

    const handleChange = (newRules) => {
        setLocalRules(newRules);
        setIsDirty(true);
    };

    const addCol = () => handleChange([...localRules, { column: "new_col", rules: [] }]);
    
    const updateColName = (idx, name) => {
        const copy = [...localRules];
        copy[idx].column = name;
        handleChange(copy);
    };

    const addRule = (colIdx, type) => {
        const copy = [...localRules];
        let rule = { type };
        if(type==='number') { rule.min=0; rule.max=100; }
        if(type==='regex') rule.pattern = "^[a-z]+$";
        if(type==='oneof') rule.options = ["option1"];
        copy[colIdx].rules.push(rule);
        handleChange(copy);
    };

    const removeRule = (colIdx, rIdx) => {
        const copy = [...localRules];
        copy[colIdx].rules.splice(rIdx, 1);
        handleChange(copy);
    };

    return (
        <div className="space-y-4 pb-20">
             {localRules.map((col, idx) => (
                 <div key={idx} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                     <div className="flex items-center gap-2 mb-2">
                         <input 
                            className="bg-transparent border-b border-slate-700 text-sm font-bold text-slate-200 focus:border-emerald-500 focus:outline-none w-full"
                            value={col.column}
                            onChange={(e) => updateColName(idx, e.target.value)}
                         />
                     </div>
                     <div className="space-y-2">
                         {col.rules.map((rule, rIdx) => (
                             <div key={rIdx} className="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800 text-xs">
                                 <span className="text-slate-400 font-mono">{rule.type}</span>
                                 <button onClick={() => removeRule(idx, rIdx)}><X className="w-3 h-3 text-slate-600 hover:text-rose-500"/></button>
                             </div>
                         ))}
                         <select 
                            className="w-full bg-slate-800 text-xs text-slate-400 border border-slate-700 rounded py-1"
                            onChange={(e) => { if(e.target.value) addRule(idx, e.target.value); e.target.value=""; }}
                        >
                             <option value="">+ Add Rule</option>
                             <option value="notempty">Required</option>
                             <option value="email">Email</option>
                             <option value="number">Number</option>
                             <option value="regex">Regex</option>
                         </select>
                     </div>
                 </div>
             ))}
             <button onClick={addCol} className="w-full py-2 border border-dashed border-slate-700 text-slate-500 text-xs hover:border-emerald-500 hover:text-emerald-500 rounded">+ Add Column</button>
             
             {isDirty && (
                 <div className="fixed bottom-24 left-6 w-[350px] animate-in slide-in-from-bottom-2">
                     <button 
                        onClick={() => { onUpdate(localRules); setIsDirty(false); }}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-xl flex items-center justify-center gap-2"
                    >
                         <Play className="w-4 h-4 fill-white" /> Re-Run Validation
                     </button>
                 </div>
             )}
        </div>
    );
}

// --- Fixer Panel ---
function FixerPanel({ column, errors, examples, onApply }) {
    const [find, setFind] = useState("");
    const [replace, setReplace] = useState("");
    const [selectedType, setSelectedType] = useState(Object.keys(errors)[0]);
    
    useEffect(() => {
        if (examples && selectedType) setFind(examples[selectedType] || "");
    }, [selectedType, examples]);

    return (
        <div className="p-8 max-w-2xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><RefreshCw className="w-6 h-6 text-emerald-500" /> Remediation: {column}</h2>
            
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl mt-8">
                <div className="flex gap-2 mb-6 overflow-x-auto border-b border-slate-800 pb-2">
                    {Object.keys(errors).map(t => (
                        <button key={t} onClick={() => setSelectedType(t)} className={`px-3 py-1 text-xs rounded-lg ${selectedType===t ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-500'}`}>{t}</button>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Find</label>
                        <input type="text" value={find} onChange={e=>setFind(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-4 text-sm font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"/>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Replace</label>
                        <input type="text" value={replace} onChange={e=>setReplace(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-4 text-sm font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"/>
                    </div>
                </div>
                <button onClick={() => { onApply(column, find, replace); setFind(""); setReplace(""); }} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg flex justify-center items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" /> Apply Fix
                </button>
            </div>
        </div>
    );
}

function StatItem({ label, value, icon }) {
    return (
        <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">{icon}</div>
            <div>
                <div className="text-xl font-mono font-bold text-slate-200 leading-none">{value}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">{label}</div>
            </div>
        </div>
    );
}