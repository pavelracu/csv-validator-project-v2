import React, { useState, useEffect } from 'react';
import { 
    AlertTriangle, CheckCircle, Download, ChevronDown, 
    ChevronRight, Search, RefreshCw, XCircle, ArrowRight 
} from 'lucide-react';

export default function ErrorDashboard({ processor }) {
    const [summary, setSummary] = useState(null);
    const [expandedCols, setExpandedCols] = useState({});
    const [fixInputs, setFixInputs] = useState({}); // { colName: { find: "", replace: "" } }

    useEffect(() => {
        if (processor) {
            refreshSummary();
        }
    }, [processor]);

    const refreshSummary = () => {
        try {
            const data = processor.get_error_summary();
            setSummary(data);
        } catch (err) {
            console.error("Failed to get summary", err);
        }
    };

    const toggleCol = (col) => {
        setExpandedCols(prev => ({ ...prev, [col]: !prev[col] }));
    };

    const updateFixInput = (col, field, val) => {
        setFixInputs(prev => ({
            ...prev,
            [col]: { ...prev[col], [field]: val }
        }));
    };

    const handleApplyFix = (col) => {
        const inputs = fixInputs[col];
        if (!inputs?.find) return;

        const findVal = inputs.find;
        const replaceVal = inputs.replace || "";
        
        const newErrorCount = processor.apply_bulk_fix(col, findVal, replaceVal);
        refreshSummary();
        
        updateFixInput(col, 'find', '');
        updateFixInput(col, 'replace', '');
    };

    const handleExport = (type) => {
        try {
            const result = processor.generate_split_export();
            const content = type === 'valid' ? result.valid : result.invalid;
            const filename = type === 'valid' ? 'clean_data.csv' : 'rows_to_fix.csv';

            const blob = new Blob([content], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Export failed", err);
        }
    };

    if (!summary) return <div className="p-4 text-slate-500">Loading analysis...</div>;

    const columnNames = Object.keys(summary.stats);
    const totalColsAffected = columnNames.length;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-4">
                    <div className="bg-white p-2 rounded-full shadow-sm">
                        <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-slate-800">{summary.total_errors.toLocaleString()}</div>
                        <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Total Errors</div>
                    </div>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex items-center gap-4">
                    <div className="bg-white p-2 rounded-full shadow-sm">
                        <XCircle className="w-6 h-6 text-orange-500" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-slate-800">{totalColsAffected}</div>
                        <div className="text-xs font-bold text-orange-400 uppercase tracking-wider">Columns Affected</div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700">Error Breakdown</h3>
                </div>
                
                {columnNames.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                        <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                        <p className="font-medium">No errors found!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {columnNames.map(col => {
                            const errorTypes = summary.stats[col];
                            const examples = summary.examples[col];
                            const totalForCol = Object.values(errorTypes).reduce((a, b) => a + b, 0);
                            const isExpanded = expandedCols[col];

                            return (
                                <div key={col} className="bg-white">
                                    <button 
                                        onClick={() => toggleCol(col)}
                                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                            <span className="font-bold text-slate-700">{col}</span>
                                            <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-medium">
                                                {totalForCol.toLocaleString()} issues
                                            </span>
                                        </div>
                                    </button>

                                    {isExpanded && (
                                        <div className="bg-slate-50 p-4 border-t border-slate-100 space-y-4">
                                            <div className="space-y-2">
                                                {Object.entries(errorTypes).map(([type, count]) => (
                                                    <div key={type} className="flex items-start gap-3 text-sm">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5" />
                                                        <div className="flex-1">
                                                            <span className="font-medium text-slate-700">{type}:</span>
                                                            <span className="text-slate-500 ml-1">{count.toLocaleString()} rows</span>
                                                            <div className="text-xs text-slate-400 mt-0.5">
                                                                Example: <span className="font-mono bg-white px-1 border border-slate-200 rounded">{examples[type]}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                                <div className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                                                    <RefreshCw className="w-3 h-3" /> Quick Fix
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="relative flex-1">
                                                        <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                        <input 
                                                            type="text" 
                                                            placeholder="Find value (e.g. Admin)" 
                                                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                                                            value={fixInputs[col]?.find || ''}
                                                            onChange={(e) => updateFixInput(col, 'find', e.target.value)}
                                                        />
                                                    </div>
                                                    <ArrowRight className="w-4 h-4 text-slate-300" />
                                                    <input 
                                                        type="text" 
                                                        placeholder="Replace with" 
                                                        className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                                                        value={fixInputs[col]?.replace || ''}
                                                        onChange={(e) => updateFixInput(col, 'replace', e.target.value)}
                                                    />
                                                    <button 
                                                        onClick={() => handleApplyFix(col)}
                                                        className="bg-slate-800 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
                                                    >
                                                        Apply
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
                <button 
                    onClick={() => handleExport('valid')}
                    className="flex flex-col items-center justify-center p-4 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors group"
                >
                    <div className="bg-white p-2 rounded-full mb-2 shadow-sm group-hover:scale-110 transition-transform">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    <span className="font-bold text-green-800">Download Valid Rows</span>
                    <span className="text-xs text-green-600">Clean data ready for use</span>
                </button>

                <button 
                    onClick={() => handleExport('invalid')}
                    className="flex flex-col items-center justify-center p-4 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors group"
                >
                    <div className="bg-white p-2 rounded-full mb-2 shadow-sm group-hover:scale-110 transition-transform">
                        <Download className="w-6 h-6 text-red-600" />
                    </div>
                    <span className="font-bold text-red-800">Download Invalid Rows</span>
                    <span className="text-xs text-red-600">With "Error_Reason" column</span>
                </button>
            </div>
        </div>
    );
}