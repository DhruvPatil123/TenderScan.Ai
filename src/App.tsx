import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import DOMPurify from 'dompurify';
import { 
  FileText, 
  Upload, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Download,
  Database,
  ArrowRight,
  ShieldCheck,
  Edit2,
  Trash2,
  HelpCircle,
  XCircle,
  Clock,
  LogIn,
  LogOut,
  User,
  ShieldAlert,
  History,
  Lock,
  Sun,
  Moon
} from 'lucide-react';
import { AnalysisResult, Requirement, Category, Status, HistoryItem } from './types';
import { extractTextFromPdf } from './services/pdfService';
import { analyzeRequirements } from './services/geminiService';
import { exportToCSV } from './lib/exportUtils';
import { SummaryDashboard } from './components/SummaryDashboard';
import { auth, db, googleProvider } from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  setDoc,
  doc,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore';

// Error handling helper as per instructions
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = React.useState<FirebaseUser | null>(null);
  const [isGuest, setIsGuest] = React.useState(false);
  const [isDarkMode, setIsDarkMode] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tenderscan_theme') === 'dark';
    }
    return false;
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadingStep, setLoadingStep] = React.useState<string>('');
  const [result, setResult] = React.useState<AnalysisResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Category | 'All'>('All');
  const [keywordFilter, setKeywordFilter] = React.useState<string | 'All'>('All');
  const [sortBy, setSortBy] = React.useState<'page' | 'category' | 'priority'>('page');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showNotes, setShowNotes] = React.useState<string | null>(null);
  const [activeReqId, setActiveReqId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = React.useState(false);

  // Sync Dark Mode
  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('tenderscan_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('tenderscan_theme', 'light');
    }
  }, [isDarkMode]);

  // Load from localStorage on mount (temporary local cache)
  React.useEffect(() => {
    const saved = localStorage.getItem('tenderscan_last_result');
    if (saved) {
      try {
        setResult(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved results', e);
      }
    }
  }, []);

  // Real-time History Sync from Firestore
  React.useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const path = `users/${user.uid}/history`;
    const q = query(
      collection(db, path),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({
        ...doc.data(),
        // Convert Firestore Timestamp to ISO string if needed for types
        timestamp: doc.data().timestamp instanceof Timestamp 
          ? doc.data().timestamp.toDate().toISOString() 
          : doc.data().timestamp
      } as HistoryItem));
      setHistory(historyData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user]);

  // Sync Auth State
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close history or reset search
      if (e.key === 'Escape') {
        if (showHistory) setShowHistory(false);
        else setSearchQuery('');
      }
      // Alt + E to Export
      if (e.altKey && e.key === 'e') {
        handleExport();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHistory, result]);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResult(null);
      localStorage.removeItem('tenderscan_last_result');
    } catch (err: any) {
      console.error('Logout failed', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
    } else {
      setError('Please select a valid PDF document.');
    }
  };

  const processFile = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      setLoadingStep('Extracting text layers...');
      let pagesText = await extractTextFromPdf(file);
      
      // Guest limitation: Max 5 pages
      if (isGuest && pagesText.length > 5) {
        setError('Guest users are limited to 5 pages per document. Please sign in for unlimited scanning.');
        pagesText = pagesText.slice(0, 5);
      }

      setLoadingStep('AI analyzing compliance matrix...');
      const analysis = await analyzeRequirements(pagesText, file.name);
      setResult(analysis);

      setLoadingStep('Syncing to secure history...');
      // Save to history if logged in
      if (user) {
        const path = `users/${user.uid}/history`;
        const historyId = `hist-${Date.now()}`;
        try {
          await setDoc(doc(db, path, historyId), {
            id: historyId,
            result: analysis,
            timestamp: new Date().toISOString(),
            userId: user.uid
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while processing the document. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const updateRequirement = (id: string, updates: Partial<Requirement>) => {
    if (!result) return;
    const newRequirements = result.requirements.map(req => 
      req.id === id ? { ...req, ...updates } : req
    );
    setResult({ ...result, requirements: newRequirements });
  };

  const deleteRequirement = (id: string) => {
    if (!result || !window.confirm('Are you sure you want to delete this requirement?')) return;
    const newRequirements = result.requirements.filter(req => req.id !== id);
    setResult({ ...result, requirements: newRequirements, totalRequirements: newRequirements.length });
  };

  const clearResults = () => {
    if (window.confirm('Clear all current results?')) {
      setResult(null);
      localStorage.removeItem('tenderscan_last_result');
    }
  };

  const handleExport = () => {
    if (isGuest) {
      setError('Exporting is restricted for Guest users. Please sign in to download results.');
      return;
    }
    if (result) exportToCSV(result);
  };

  const filteredRequirements = React.useMemo(() => {
    const filtered = result?.requirements.filter(req => {
      const matchesFilter = filter === 'All' || req.category === filter;
      const matchesKeyword = keywordFilter === 'All' || req.keyword.toLowerCase() === keywordFilter.toLowerCase();
      const matchesSearch = req.requirement.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           req.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (req.notes || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesKeyword && matchesSearch;
    }) || [];

    return [...filtered].sort((a, b) => {
      if (sortBy === 'page') return a.pageNumber - b.pageNumber;
      if (sortBy === 'category') return a.category.localeCompare(b.category);
      if (sortBy === 'priority') {
        const order = { High: 0, Medium: 1, Low: 2 };
        return order[a.priority] - order[b.priority];
      }
      return 0;
    });
  }, [result, filter, keywordFilter, searchQuery, sortBy]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const batchUpdateStatus = (status: Status) => {
    if (!result) return;
    const requirements = result.requirements.map(req => 
      selectedIds.has(req.id) ? { ...req, status } : req
    );
    setResult({ ...result, requirements });
    setSelectedIds(new Set());
  };

  const stats = React.useMemo(() => {
    if (!result) return null;
    return {
      technical: result.requirements.filter(r => r.category === 'Technical').length,
      financial: result.requirements.filter(r => r.category === 'Financial').length,
      legal: result.requirements.filter(r => r.category === 'Legal').length,
      other: result.requirements.filter(r => r.category === 'Other').length,
      compliant: result.requirements.filter(r => r.status === 'compliant').length,
      total: result.requirements.length
    };
  }, [result]);

  const getStatusIcon = (status: Status) => {
    switch (status) {
      case 'compliant': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'exception': return <XCircle className="w-4 h-4 text-rose-500" />;
      case 'clarify': return <HelpCircle className="w-4 h-4 text-amber-500" />;
      default: return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-[#FBFBFC] flex flex-col items-center justify-center p-6 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:40px_40px] bg-opacity-[0.03]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-10 rounded-[32px] border border-slate-200 shadow-2xl text-center"
        >
          <div className="w-16 h-16 bg-[#0F172A] rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-slate-200">
            <ShieldCheck className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 mb-4 font-inter">Welcome to TenderScan.ai</h1>
          <p className="text-slate-500 mb-10 font-medium leading-relaxed font-inter">
            The enterprise-grade solution for tender requirement extraction and compliance auditing. 
            Sign in to start your scan.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg active:scale-95"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
          
          <button 
            onClick={() => setIsGuest(true)}
            className="w-full mt-4 bg-white border border-slate-200 text-slate-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <User className="w-5 h-5" />
            Continue as Guest (Skip Login)
          </button>
          <p className="mt-8 text-[11px] text-slate-400 font-bold uppercase tracking-widest font-mono">
            V1.0.0
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFBFC] text-[#0F172A] font-inter selection:bg-black selection:text-white">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/70 backdrop-blur-xl border-b border-gray-100 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div 
            onClick={() => setResult(null)}
            className="flex items-center gap-3 cursor-pointer group transition-transform active:scale-95"
          >
            <div className="w-9 h-9 bg-[#0F172A] rounded-xl flex items-center justify-center shadow-lg shadow-black/10 group-hover:shadow-[#0F172A]/20 transition-all">
              <ShieldCheck className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">TenderScan<span className="text-slate-400">.ai</span></span>
          </div>
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-6 text-[13px] font-semibold text-slate-500">
              <div className="flex items-center gap-2 text-slate-900 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                <User className="w-3.5 h-3.5" />
                <span className="max-w-[120px] truncate">{user?.email || 'Guest User'}</span>
              </div>
            </nav>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />
            
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
              title="Toggle Theme"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <button 
              onClick={() => setShowHistory(true)}
              className="relative p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
              title="View History"
            >
              <History className="w-5 h-5" />
              {user && history.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white shadow-sm" />
              )}
            </button>

            <button 
              onClick={() => {
                handleLogout();
                setIsGuest(false);
              }}
              className="text-slate-500 hover:text-rose-500 transition-colors p-2"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="pt-24 pb-20 px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-12">
                <h1 className="text-6xl font-extrabold tracking-tight mb-6 bg-gradient-to-b from-slate-950 to-slate-600 bg-clip-text text-transparent leading-[1.1] font-inter">
                  Turn Tenders into Teamsheets.
                </h1>
                <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed mb-8">
                  TenderScan.ai simplifies the procurement process by automatically identifying and categorizing mandatory requirements from your complex tender documents.
                </p>
                
                <div className="flex flex-wrap justify-center gap-4 mb-12">
                  {[
                    { step: 1, text: "Upload Tender PDF" },
                    { step: 2, text: "AI Requirement Scan" },
                    { step: 3, text: "Export Compliance Matrix" }
                  ].map((s) => (
                    <div key={s.step} className="flex items-center gap-3 bg-white border border-slate-100 px-4 py-2 rounded-2xl shadow-sm">
                      <span className="w-6 h-6 bg-slate-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {s.step}
                      </span>
                      <span className="text-sm font-semibold text-slate-600">{s.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-2 rounded-[32px] border border-slate-200 shadow-[0_20px_50px_rgba(0,0,0,0.04)]">
                <div className="p-10 border-2 border-dashed border-slate-100 rounded-[28px] hover:border-slate-300 transition-all cursor-pointer group relative bg-slate-50/30">
                  <input 
                    type="file" 
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  />
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-white rounded-3xl shadow-xl shadow-slate-200/50 flex items-center justify-center mb-6 group-hover:-translate-y-1 transition-transform duration-500">
                      <Upload className="text-slate-400 w-8 h-8" />
                    </div>
                    {file ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100">
                          <CheckCircle2 className="w-5 h-5" />
                          <span>{file.name}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    ) : (
                      <div className="text-center">
                        <h3 className="text-xl font-bold mb-2">Drop your Tender PDF here</h3>
                        <p className="text-sm text-slate-400 font-medium whitespace-nowrap">Automatic extraction of all 'shall' & 'must' requirements</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100">
                  <button 
                    onClick={processFile}
                    disabled={!file || isLoading}
                    className="w-full bg-[#0F172A] text-white px-10 py-5 rounded-2xl font-bold hover:shadow-2xl hover:shadow-slate-300/50 disabled:bg-slate-200 disabled:cursor-not-allowed transition-all transform active:scale-[0.98] flex items-center justify-center gap-4 text-lg"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-6 h-6 border-3 border-white/20 border-t-white rounded-full animate-spin" />
                        AI Extraction in Progress...
                      </>
                    ) : (
                      <>
                        Initialize Deep Scan
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="m-4 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 justify-center text-sm font-semibold border border-red-100"
                  >
                    <AlertCircle className="w-5 h-5" />
                    {error}
                  </motion.div>
                )}
              </div>

              <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-10">
                {[
                  { icon: FileText, title: "Precision Parser", desc: "Native PDF processing preserves page numbers and context markers." },
                  { icon: Search, title: "Category Logic", desc: "Automated sorting into Technical, Legal, and Financial workstreams." },
                  { icon: Download, title: "Dynamic Sync", desc: "Export to CSV or sync directly to your Supabase cloud database." }
                ].map((item, i) => (
                  <div key={i} className="group cursor-default">
                    <div className="w-12 h-12 bg-white shadow-sm border border-slate-200 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-slate-950 group-hover:text-white transition-all">
                      <item.icon className="w-6 h-6" />
                    </div>
                    <h4 className="font-bold text-slate-900 mb-2 truncate text-base">{item.title}</h4>
                    <p className="text-sm text-slate-500 leading-relaxed font-medium">{item.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm col-span-2 lg:col-span-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Total Needs</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold">{stats?.total}</span>
                    <span className="text-emerald-500 text-xs font-bold font-mono tracking-tighter">100% Extract</span>
                  </div>
                </div>
                {[
                  { label: 'Technical', count: stats?.technical, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Financial', count: stats?.financial, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'Legal', count: stats?.legal, color: 'text-rose-600', bg: 'bg-rose-50' },
                  { label: 'Compliant', count: `${stats?.compliant}/${stats?.total}`, color: 'text-emerald-600', bg: 'bg-emerald-50' }
                ].map((s, i) => (
                  <div key={i} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">{s.label}</span>
                    <span className={`text-2xl font-extrabold ${s.color}`}>{s.count}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-2 font-mono uppercase tracking-widest">
                    <FileText className="w-3.5 h-3.5" />
                    <span>{result.documentName}</span>
                  </div>
                  <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 leading-none">Compliance Matrix</h2>
                </div>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={clearResults}
                    className="text-xs font-bold text-slate-500 hover:text-black px-4 py-2 transition-colors uppercase tracking-widest"
                  >
                    Clear Matrix
                  </button>
                  <button 
                    onClick={handleExport}
                    className="bg-slate-950 text-white px-5 py-3 rounded-2xl text-[13px] font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>
                </div>
              </div>

              <SummaryDashboard result={result} />

              <div className="flex flex-col gap-4 mb-8">
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-[24px] border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center gap-3">
                  <div className="relative flex-1 group w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors" />
                    <input 
                      type="text" 
                      placeholder="Search requirements, notes or identifiers..."
                      className="w-full bg-slate-50 dark:bg-slate-800/50 border-none focus:bg-white dark:focus:bg-slate-800 focus:ring-1 focus:ring-slate-200 dark:focus:ring-slate-700 rounded-[18px] py-3.5 pl-12 pr-4 text-sm transition-all outline-none font-medium dark:text-white"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden md:block mx-1" />
                  <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto no-scrollbar py-1">
                    {['All', 'Technical', 'Financial', 'Legal', 'Other'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFilter(cat as any)}
                        className={`text-[11px] font-black uppercase tracking-widest px-4 py-2.5 rounded-2xl transition-all whitespace-nowrap ${
                          filter === cat 
                            ? 'bg-slate-900 text-white shadow-lg shadow-black/10 dark:bg-white dark:text-black' 
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden md:block mx-1" />
                  <select 
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="bg-slate-100 dark:bg-slate-800 border-none text-[11px] font-black uppercase tracking-widest px-4 py-3 rounded-2xl outline-none cursor-pointer dark:text-white"
                  >
                    <option value="page">Sort by Page</option>
                    <option value="category">Sort by Category</option>
                    <option value="priority">Sort by Priority</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600 ml-4">Keyword Focus:</span>
                  {['All', 'Shall', 'Must', 'Required', 'Will'].map((key) => (
                    <button
                      key={key}
                      onClick={() => setKeywordFilter(key)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                        keywordFilter === key
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400'
                          : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                  
                  {selectedIds.size > 0 && (
                    <div className="flex items-center gap-2 ml-auto animate-in slide-in-from-right-4 duration-300">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
                        {selectedIds.size} Selected
                      </span>
                      <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />
                      {['compliant', 'exception', 'clarify'].map((tag) => (
                        <button
                          key={tag}
                          onClick={() => batchUpdateStatus(tag as Status)}
                          className="text-[10px] font-black uppercase tracking-widest bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-1.5 rounded-full shadow-lg shadow-black/5 hover:scale-105 active:scale-95 transition-all"
                        >
                          Mark {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-[32px] border border-slate-200 shadow-[0_8px_40px_rgba(0,0,0,0.02)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-16">
                          <input 
                            type="checkbox" 
                            className="rounded border-slate-200 text-slate-900 focus:ring-slate-100"
                            checked={selectedIds.size === filteredRequirements.length && filteredRequirements.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedIds(new Set(filteredRequirements.map(r => r.id)));
                              else setSelectedIds(new Set());
                            }}
                          />
                        </th>
                        <th className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-36 text-center">Status</th>
                        <th className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Structure & Content</th>
                        <th className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-32 text-center">Reference</th>
                        <th className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-24 text-right pr-10 whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRequirements.map((req, idx) => (
                        <motion.tr 
                          key={req.id}
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.03 }}
                          className="group hover:bg-slate-50/40 transition-all duration-300"
                        >
                          <td className="px-6 py-6 font-mono text-[10px] text-slate-300 font-bold">
                            <input 
                              type="checkbox" 
                              className="rounded border-slate-200 text-slate-900 focus:ring-slate-100"
                              checked={selectedIds.has(req.id)}
                              onChange={() => toggleSelect(req.id)}
                            />
                          </td>
                          <td className="px-6 py-6 text-center">
                            <div className="inline-block relative">
                              <select 
                                value={req.status}
                                onChange={(e) => updateRequirement(req.id, { status: e.target.value as Status })}
                                className={`appearance-none bg-transparent font-bold text-[10px] uppercase tracking-widest pl-8 pr-3 py-2 rounded-full border transition-all cursor-pointer outline-none focus:ring-2 focus:ring-slate-100 ${
                                  req.status === 'compliant' ? 'text-emerald-600 border-emerald-100 bg-emerald-50/50' :
                                  req.status === 'exception' ? 'text-rose-600 border-rose-100 bg-rose-50/50' :
                                  req.status === 'clarify' ? 'text-amber-600 border-amber-100 bg-amber-50/50' :
                                  'text-slate-500 border-slate-100 bg-slate-50'
                                }`}
                              >
                                <option value="pending">Pending</option>
                                <option value="compliant">Compliant</option>
                                <option value="exception">Exception</option>
                                <option value="clarify">Clarify</option>
                              </select>
                              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                {getStatusIcon(req.status)}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-6">
                            <div className="flex flex-col gap-2.5">
                              <div className="flex items-center gap-2">
                                <select 
                                  value={req.category}
                                  onChange={(e) => updateRequirement(req.id, { category: e.target.value as Category })}
                                  className={`text-[9px] font-extrabold uppercase tracking-[0.15em] px-2 py-0.5 rounded-md border transition-all outline-none ${
                                    req.category === 'Technical' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                    req.category === 'Financial' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                    req.category === 'Legal' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                                    'bg-slate-50 text-slate-700 border-slate-100'
                                  }`}
                                >
                                  <option value="Technical">Tech</option>
                                  <option value="Financial">Fin</option>
                                  <option value="Legal">Legal</option>
                                  <option value="Other">Other</option>
                                </select>
                                <select 
                                  value={req.priority}
                                  onChange={(e) => updateRequirement(req.id, { priority: e.target.value as any })}
                                  className={`text-[9px] font-extrabold uppercase tracking-[0.15em] px-2 py-0.5 rounded-md border transition-all outline-none ${
                                    req.priority === 'High' ? 'bg-rose-950 text-white border-rose-900' :
                                    req.priority === 'Medium' ? 'bg-amber-950 text-white border-amber-900' :
                                    'bg-slate-100 text-slate-500 border-slate-200'
                                  }`}
                                >
                                  <option value="High">Priority: High</option>
                                  <option value="Medium">Priority: Mid</option>
                                  <option value="Low">Priority: Low</option>
                                </select>
                                <span className="text-[10px] font-bold text-slate-300 font-mono italic">Keyword: {req.keyword}</span>
                              </div>
                              {editingId === req.id ? (
                                <textarea
                                  autoFocus
                                  className="text-sm font-semibold text-slate-900 bg-slate-50 p-3 rounded-xl border border-slate-200 w-full outline-none focus:ring-2 focus:ring-slate-100 min-h-[100px]"
                                  value={req.requirement}
                                  onChange={(e) => updateRequirement(req.id, { requirement: e.target.value })}
                                  onBlur={() => setEditingId(null)}
                                />
                              ) : (
                                <p 
                                  className="text-sm text-slate-700 dark:text-slate-300 leading-snug font-semibold group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
                                  onClick={() => setActiveReqId(req.id)}
                                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(req.requirement) }}
                                />
                              )}
                              
                              {showNotes === req.id || req.notes ? (
                                <div className="mt-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                                  <textarea
                                    placeholder="Add compliance notes or internal comments..."
                                    className="w-full bg-transparent border-none text-xs font-medium text-slate-500 outline-none resize-none"
                                    value={req.notes || ''}
                                    onChange={(e) => updateRequirement(req.id, { notes: e.target.value })}
                                    onFocus={() => setShowNotes(req.id)}
                                    onBlur={() => setShowNotes(null)}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-6 text-center">
                            <div className="inline-flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                              <span className="font-mono text-[11px] font-bold text-slate-500 whitespace-nowrap">PAGE {req.pageNumber}</span>
                            </div>
                          </td>
                          <td className="px-6 py-6 pr-10">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                              <button 
                                onClick={() => setShowNotes(req.id)}
                                className={`p-2.5 rounded-xl border border-transparent hover:border-slate-200 transition-all ${req.notes ? 'text-emerald-500' : 'text-slate-400'}`}
                                title="Add/Edit Notes"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => deleteRequirement(req.id)}
                                className="p-2.5 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all"
                                title="Remove Requirement"
                              >
                                <Trash2 className="w-4 h-4 text-slate-400 hover:text-rose-500" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                      {filteredRequirements.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-20 text-center">
                            <div className="flex flex-col items-center gap-4 bg-slate-50 rounded-3xl p-10 max-w-sm mx-auto border border-slate-100">
                              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                <Search className="w-7 h-7 text-slate-200" />
                              </div>
                              <p className="text-slate-400 text-sm font-bold tracking-tight">Requirement not found in current view.</p>
                              <button onClick={() => {setFilter('All'); setSearchQuery('');}} className="text-xs font-bold text-slate-900 underline underline-offset-4">Reset Filters</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Progress Tracker Footer */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-white/80 backdrop-blur-xl border border-slate-200 px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border-4 border-slate-100 border-t-emerald-500 flex items-center justify-center">
                    <span className="text-[10px] font-black">{Math.round((stats?.compliant || 0) / (stats?.total || 1) * 100)}%</span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Audit Progress</span>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <button className="text-[11px] font-black text-slate-950 uppercase tracking-widest flex items-center gap-2 group">
                  Finalize Scan
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Side Panel: Requirement Reasoning & Context */}
      <AnimatePresence>
        {activeReqId && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveReqId(null)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[80]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-slate-900 z-[90] shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest block mb-1">Audit Deep Dive</span>
                  <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Requirement Insight</h2>
                </div>
                <button 
                  onClick={() => setActiveReqId(null)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                >
                  <XCircle className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {result?.requirements.find(r => r.id === activeReqId) && (
                  <>
                    <section>
                      <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">The Requirement</h4>
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-[28px] border border-slate-100 dark:border-slate-800">
                        <p className="text-lg font-bold text-slate-900 dark:text-white leading-relaxed">
                          {result.requirements.find(r => r.id === activeReqId)?.requirement}
                        </p>
                      </div>
                    </section>

                    <section className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Found on Page</span>
                        <span className="text-xl font-black text-slate-900 dark:text-white font-mono">{result.requirements.find(r => r.id === activeReqId)?.pageNumber}</span>
                      </div>
                      <div className="p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Mandatory Keyword</span>
                        <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 uppercase">{result.requirements.find(r => r.id === activeReqId)?.keyword}</span>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">AI Reasoning & Insight</h4>
                      <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-6 rounded-[28px] border border-emerald-100/50 dark:border-emerald-900/30">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 leading-relaxed italic">
                          "{result.requirements.find(r => r.id === activeReqId)?.reasoning || "Analyzing context... the AI flagged this due to the presence of mandatory modal verbs indicating a binding contractual obligation."}"
                        </p>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Compliance Status</h4>
                      <div className="flex flex-wrap gap-2">
                        {['pending', 'compliant', 'exception', 'clarify'].map((status) => (
                          <button
                            key={status}
                            onClick={() => updateRequirement(activeReqId!, { status: status as Status })}
                            className={`px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest border transition-all ${
                              result?.requirements.find(r => r.id === activeReqId)?.status === status
                                ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-black dark:border-white'
                                : 'bg-white text-slate-400 border-slate-100 dark:bg-slate-800 dark:text-slate-500 dark:border-transparent'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </div>
              
              <div className="p-8 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={() => setActiveReqId(null)}
                  className="w-full bg-slate-950 dark:bg-white text-white dark:text-black py-4 rounded-2xl font-bold uppercase tracking-widest shadow-xl shadow-slate-200 dark:shadow-none"
                >
                  Save & Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* History Drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[90] dark:bg-slate-950/60 transition-colors"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 z-[100] shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-900 dark:bg-white rounded-xl flex items-center justify-center text-white dark:text-black">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg dark:text-white">Scan History</h2>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">Persistence Engine</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors"
                >
                  <XCircle className="w-6 h-6 text-slate-300 dark:text-slate-700" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {!user ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                    <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-slate-200 dark:text-slate-700">
                      <Lock className="w-10 h-10" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">History is Restricted</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-[240px]">
                        Guests cannot save or view history. Sign in to keep track of your compliance audits.
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setShowHistory(false);
                        setIsGuest(false);
                      }}
                      className="bg-slate-950 dark:bg-white text-white dark:text-black px-8 py-3 rounded-2xl font-bold text-sm shadow-xl shadow-slate-200 dark:shadow-none"
                    >
                      Sign In Now
                    </button>
                  </div>
                ) : history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-200 dark:text-slate-700">
                      <Clock className="w-8 h-8" />
                    </div>
                    <p className="text-slate-400 font-bold text-sm">No scans in your history yet.</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setResult(item.result);
                        setShowHistory(false);
                      }}
                      className="w-full bg-slate-50/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 p-4 rounded-2xl text-left transition-all group flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold text-slate-400 font-mono">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] bg-slate-900 dark:bg-white text-white dark:text-black px-2 py-0.5 rounded-full font-bold">
                          {item.result.requirements.length} REQS
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 dark:text-white truncate w-full group-hover:text-emerald-600 transition-colors">
                        {item.result.documentName}
                      </h4>
                    </button>
                  ))
                )}
              </div>
              
              {user && history.length > 0 && (
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 italic text-[10px] text-slate-300 font-bold text-center">
                  Showing last {history.length} audit sessions
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Enhanced Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[100] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative mb-12">
              <div className="w-32 h-32 border-4 border-slate-800 rounded-full" />
              <div className="absolute inset-0 w-32 h-32 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <ShieldCheck className="w-12 h-12 text-emerald-500 animate-pulse" />
              </div>
            </div>
            
            <div className="max-w-md w-full">
              <motion.div
                key={loadingStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
              >
                <h3 className="text-2xl font-extrabold text-white mb-2">{loadingStep || 'Initializing Audit...'}</h3>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.3em]">Compliance Agent Active</p>
              </motion.div>

              <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 15, ease: "linear" }}
                  className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                />
              </div>
              <p className="mt-4 text-[10px] text-slate-500 font-mono font-bold italic">Processing large matrix nodes via Gemini 1.5 Flash...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decorative elements */}
      <div className="fixed inset-0 pointer-events-none z-[-1] opacity-[0.03] select-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:40px_40px]" />
      </div>
    </div>
  );
}
