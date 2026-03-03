import {
  useState, useEffect, useCallback, useRef, createContext, useContext, type ChangeEvent,
} from 'react';
import axios from 'axios';
import {
  LayoutDashboard, Trophy, Users, FileCode, BarChart3, Settings,
  Plus, Trash2, Edit3, Play, Download, Copy, Check, RefreshCw,
  ChevronRight, X, AlertTriangle, Menu, Moon, Sun, Zap, Shield,
  TrendingUp, Activity, Search, ArrowLeft,
  CheckCircle2, XCircle, Swords, Save, Upload, Filter,
} from 'lucide-react';
import './AdminDashboard.css';

/* ─── API helper ──────────────────────────────────────────── */
const API = (path: string) => `${(import.meta.env.VITE_API_URL as string) || ''}/api/admin${path}`;

/* ─── Toast Context ───────────────────────────────────────── */
type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; msg: string; type: ToastType }
const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {});
function useToast() { return useContext(ToastCtx); }

/* ─── Types ───────────────────────────────────────────────── */
interface Problem {
  id: string; title: string; slug: string; description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard'; tags: string[];
  constraints: string; input_format: string; output_format: string;
  time_limit: number; memory_limit: number; is_published: boolean;
  problem_set: 'A' | 'B' | 'Both' | 'Bonus' | 'none';
  tc_count: number; sub_count: number; ac_count: number;
}
interface Tournament {
  id: string; name: string; description: string;
  pairs: TournamentPair[]; rooms: string[];
  status: 'upcoming' | 'live' | 'ended';
  questionCount: number; createdAt: number;
  startDate?: string; endDate?: string;
  enableLeaderboard?: boolean; enableBonus?: boolean;
  visibility?: string;
  questionIds?: string[];
}

interface TournamentPair {
  pairNo: number; roomCode: string; teamACode: string; teamBCode: string;
}
interface LeaderboardEntry {
  rank: number; teamName: string; teamCode: string;
  roomCode: string; solved: number; gridCells: number;
  phase: string; winner: string | null;
}
interface Submission {
  id: string; room_code: string; team_id: string; language: string;
  verdict: string; test_cases_passed: number; total_test_cases: number;
  time_taken: number; created_at: string;
  problem_title: string; difficulty: string;
}
interface StatsData {
  problems: number; published: number;
  totalSubmissions: number; acceptedSubmissions: number;
  acceptanceRate: number; trend: { hr: string; cnt: string }[];
}

/* ────────────────────────────────────────────────────────────
   Tiny Skeleton component
──────────────────────────────────────────────────────────── */
function Skeleton({ h = 20, w = '100%', r = 8 }: { h?: number; w?: string | number; r?: number }) {
  return <div className="adm-skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

/* ────────────────────────────────────────────────────────────
   Confirmation Modal
──────────────────────────────────────────────────────────── */
function ConfirmModal({
  open, title, msg, onConfirm, onCancel, danger = true,
}: {
  open: boolean; title: string; msg: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="adm-overlay" onClick={onCancel}>
      <div className="adm-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="adm-modal-icon">
          <AlertTriangle size={32} color={danger ? '#ef4444' : '#f59e0b'} />
        </div>
        <h3 className="adm-modal-title">{title}</h3>
        <p className="adm-modal-msg">{msg}</p>
        <div className="adm-modal-footer">
          <button className="adm-btn adm-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`adm-btn ${danger ? 'adm-btn-danger' : 'adm-btn-primary'}`} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Status Badge
──────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming: 'badge-upcoming', live: 'badge-live', ended: 'badge-ended',
    accepted: 'badge-accepted', wrong_answer: 'badge-wa', compilation_error: 'badge-ce',
    time_limit_exceeded: 'badge-tle', runtime_error: 'badge-re', system_error: 'badge-se',
  };
  const labels: Record<string, string> = {
    upcoming: 'Upcoming', live: '🔴 Live', ended: 'Ended',
    accepted: 'AC', wrong_answer: 'WA', compilation_error: 'CE',
    time_limit_exceeded: 'TLE', runtime_error: 'RE', system_error: 'SE',
  };
  return <span className={`adm-badge ${map[status] || 'badge-default'}`}>{labels[status] || status}</span>;
}

/* ────────────────────────────────────────────────────────────
   DASHBOARD OVERVIEW
──────────────────────────────────────────────────────────── */
function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentSubs, setRecentSubs] = useState<Submission[]>([]);

  useEffect(() => {
    Promise.all([
      axios.get(API('/stats')).then(r => setStats(r.data)),
      axios.get(API('/submissions?limit=10')).then(r => setRecentSubs(r.data.submissions || [])),
    ]).finally(() => setLoading(false));
  }, []);

  const cards = stats ? [
    { icon: <FileCode size={22} />, label: 'Total Problems', value: stats.problems, sub: `${stats.published} published`, color: 'card-blue' },
    { icon: <Zap size={22} />, label: 'Total Submissions', value: stats.totalSubmissions, sub: 'all time', color: 'card-purple' },
    { icon: <CheckCircle2 size={22} />, label: 'Accepted', value: stats.acceptedSubmissions, sub: `${stats.acceptanceRate}% rate`, color: 'card-green' },
    { icon: <TrendingUp size={22} />, label: 'Acceptance Rate', value: `${stats.acceptanceRate}%`, sub: 'accepted / total', color: 'card-amber' },
  ] : [];

  const max = Math.max(...stats?.trend?.map(t => parseInt(t.cnt)) ?? [1]);

  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <div>
          <h2 className="adm-page-title">Dashboard</h2>
          <p className="adm-page-sub">Platform overview and analytics</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="adm-stat-grid">
        {loading
          ? Array(4).fill(0).map((_, i) => <div key={i} className="adm-stat-card"><Skeleton h={80} /></div>)
          : cards.map(c => (
            <div key={c.label} className={`adm-stat-card ${c.color}`}>
              <div className="adm-stat-icon">{c.icon}</div>
              <div className="adm-stat-body">
                <div className="adm-stat-value">{c.value}</div>
                <div className="adm-stat-label">{c.label}</div>
                <div className="adm-stat-sub">{c.sub}</div>
              </div>
            </div>
          ))}
      </div>

      <div className="adm-two-col">
        {/* Submission trend */}
        <div className="adm-card">
          <div className="adm-card-header">
            <h3 className="adm-card-title">Submissions (Last 24h)</h3>
          </div>
          <div className="adm-chart-bar">
            {loading
              ? <Skeleton h={100} />
              : stats?.trend.length === 0
                ? <div className="adm-empty-chart">No submissions in last 24h</div>
                : stats?.trend.map((t, i) => (
                  <div key={i} className="adm-bar-wrap" title={`${t.cnt} submissions`}>
                    <div className="adm-bar" style={{ height: `${Math.max(4, (parseInt(t.cnt) / max) * 100)}%` }} />
                    <div className="adm-bar-label">{t.hr?.slice(11, 16) || t.hr}</div>
                  </div>
                ))
            }
          </div>
        </div>

        {/* Recent submissions */}
        <div className="adm-card">
          <div className="adm-card-header">
            <h3 className="adm-card-title">Recent Submissions</h3>
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Room</th><th>Problem</th><th>Verdict</th><th>Time</th></tr></thead>
              <tbody>
                {loading
                  ? Array(5).fill(0).map((_, i) => (
                    <tr key={i}><td colSpan={4}><Skeleton h={24} /></td></tr>
                  ))
                  : recentSubs.map(s => (
                    <tr key={s.id}>
                      <td><span className="adm-mono">{s.room_code}-{s.team_id}</span></td>
                      <td>{s.problem_title || '—'}</td>
                      <td><StatusBadge status={s.verdict} /></td>
                      <td className="adm-muted">{s.time_taken ? `${s.time_taken}ms` : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!loading && recentSubs.length === 0 && (
              <div className="adm-empty">No submissions yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   CREATE TOURNAMENT MODAL
──────────────────────────────────────────────────────────── */
function CreateTournamentModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (t: Tournament) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', pairs: 4, questionCount: 17,
    startDate: '', endDate: '', visibility: 'private',
    enableLeaderboard: true, enableBonus: true,
  });

  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast('Tournament name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await axios.post(API('/tournaments'), form);
      toast(`Tournament "${form.name}" created with ${form.pairs} rooms!`, 'success');
      onCreate(res.data.tournament);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to create tournament', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-modal adm-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="adm-modal-header">
          <h3>Create Tournament</h3>
          <button className="adm-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="adm-form-grid">
          <div className="adm-form-full">
            <label>Tournament Name *</label>
            <input className="adm-input" placeholder="Semester Finals 2026" value={form.name}
              onChange={e => setF('name', e.target.value)} />
          </div>
          <div className="adm-form-full">
            <label>Description</label>
            <textarea className="adm-textarea" rows={2} placeholder="Optional description"
              value={form.description} onChange={e => setF('description', e.target.value)} />
          </div>
          <div>
            <label>Number of 1v1 Pairs</label>
            <div className="adm-quick-btns">
              {[2, 4, 8, 16, 32].map(n => (
                <button key={n} className={`adm-quick-btn ${form.pairs === n ? 'active' : ''}`}
                  onClick={() => setF('pairs', n)}>{n}</button>
              ))}
              <input type="number" className="adm-input adm-input-sm" min={1} max={50}
                value={form.pairs} onChange={e => setF('pairs', +e.target.value)} />
            </div>
            <div className="adm-hint">→ {form.pairs * 2} teams total</div>
          </div>
          <div>
            <label>Questions per Room</label>
            <div className="adm-quick-btns">
              {[15, 16, 17].map(n => (
                <button key={n} className={`adm-quick-btn ${form.questionCount === n ? 'active' : ''}`}
                  onClick={() => setF('questionCount', n)}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <label>Start Date & Time</label>
            <input className="adm-input" type="datetime-local" value={form.startDate}
              onChange={e => setF('startDate', e.target.value)} />
          </div>
          <div>
            <label>End Date & Time</label>
            <input className="adm-input" type="datetime-local" value={form.endDate}
              onChange={e => setF('endDate', e.target.value)} />
          </div>
          <div>
            <label>Visibility</label>
            <select className="adm-select" value={form.visibility} onChange={e => setF('visibility', e.target.value)}>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </div>
          <div className="adm-toggle-row">
            <div className="adm-toggle-item">
              <span>Enable Leaderboard</span>
              <button className={`adm-toggle ${form.enableLeaderboard ? 'on' : ''}`}
                onClick={() => setF('enableLeaderboard', !form.enableLeaderboard)} />
            </div>
            <div className="adm-toggle-item">
              <span>Enable Bonus Mode</span>
              <button className={`adm-toggle ${form.enableBonus ? 'on' : ''}`}
                onClick={() => setF('enableBonus', !form.enableBonus)} />
            </div>
          </div>
        </div>
        <div className="adm-modal-footer">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="adm-btn adm-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={15} className="spinning" /> : <Plus size={15} />}
            {saving ? 'Creating…' : 'Create Tournament'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MANAGE TOURNAMENT (full detail view)
──────────────────────────────────────────────────────────── */
function ManageTournament({ tournament, onBack }: { tournament: Tournament; onBack: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'config' | 'teams' | 'questions' | 'analytics' | 'leaderboard'>('teams');
  const [t, setT] = useState(tournament);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  };

  const startTournament = async () => {
    setStarting(true);
    try {
      await axios.post(API(`/tournaments/${t.id}/start`));
      setT(p => ({ ...p, status: 'live' }));
      toast('All rooms started!', 'success');
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to start', 'error');
    }
    setStarting(false);
  };

  const downloadCSV = () => {
    const rows = ['Pair,Room Code,Team A Code,Team B Code'];
    t.pairs.forEach(p => rows.push(`${p.pairNo},${p.roomCode},${p.teamACode},${p.teamBCode}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name}.csv`; a.click();
  };

  const tabs = [
    { key: 'teams', label: 'Teams', icon: <Users size={14} /> },
    { key: 'config', label: 'Configuration', icon: <Settings size={14} /> },
    { key: 'questions', label: 'Questions', icon: <FileCode size={14} /> },
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={14} /> },
    { key: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={14} /> },
  ] as const;

  return (
    <div className="adm-page">
      <div className="adm-manage-header">
        <button className="adm-btn adm-btn-ghost adm-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Tournaments
        </button>
        <div className="adm-manage-title-row">
          <h2 className="adm-page-title">{t.name}</h2>
          <StatusBadge status={t.status} />
        </div>
        <div className="adm-manage-actions">
          <span className="adm-muted">{t.pairs.length} rooms · {t.pairs.length * 2} teams</span>
          <button className="adm-btn adm-btn-ghost" onClick={downloadCSV}>
            <Download size={15} /> CSV
          </button>
          {t.status === 'upcoming' && (
            <button className="adm-btn adm-btn-success" onClick={startTournament} disabled={starting}>
              {starting ? <RefreshCw size={15} className="spinning" /> : <Play size={15} />}
              Start All Rooms
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="adm-tabs">
        {tabs.map(tb => (
          <button key={tb.key} className={`adm-tab ${tab === tb.key ? 'active' : ''}`}
            onClick={() => setTab(tb.key)}>
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {tab === 'teams' && <TeamsTab tournament={t} copied={copied} copy={copy} />}
      {tab === 'config' && <ConfigTab tournament={t} onChange={setT} />}
      {tab === 'questions' && <QuestionsTabInTournament tournament={t} onUpdate={(ids) => setT(p => ({ ...p, questionIds: ids }))} />}
      {tab === 'analytics' && <AnalyticsTabInTournament tournamentId={t.id} />}
      {tab === 'leaderboard' && <LeaderboardTabInTournament tournamentId={t.id} />}
    </div>
  );
}

function TeamsTab({ tournament, copied, copy }: {
  tournament: Tournament;
  copied: string | null;
  copy: (text: string, key: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = tournament.pairs.filter(p =>
    !search || [p.teamACode, p.teamBCode, p.roomCode].some(s =>
      s.toLowerCase().includes(search.toLowerCase())
    )
  );

  return (
    <div className="adm-card adm-mt">
      <div className="adm-card-header">
        <h3 className="adm-card-title">Team Pairs ({tournament.pairs.length})</h3>
        <div className="adm-search-wrap">
          <Search size={14} className="adm-search-icon" />
          <input className="adm-search" placeholder="Search codes..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team A Code</th>
              <th>Team B Code</th>
              <th>Room Code</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(pair => (
              <tr key={pair.pairNo}>
                <td className="adm-muted">{pair.pairNo}</td>
                <td>
                  <div className="adm-code-cell">
                    <span className="adm-code adm-code-a">{pair.teamACode}</span>
                    <button className="adm-copy-btn" onClick={() => copy(pair.teamACode, `a${pair.pairNo}`)}>
                      {copied === `a${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td>
                  <div className="adm-code-cell">
                    <span className="adm-code adm-code-b">{pair.teamBCode}</span>
                    <button className="adm-copy-btn" onClick={() => copy(pair.teamBCode, `b${pair.pairNo}`)}>
                      {copied === `b${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td>
                  <div className="adm-code-cell">
                    <span className="adm-mono">{pair.roomCode}</span>
                    <button className="adm-copy-btn" onClick={() => copy(pair.roomCode, `r${pair.pairNo}`)}>
                      {copied === `r${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="adm-empty">No pairs found</div>}
      </div>
    </div>
  );
}

function ConfigTab({ tournament, onChange }: { tournament: Tournament; onChange: (t: Tournament) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: tournament.name,
    description: tournament.description || '',
    startDate: tournament.startDate || '',
    endDate: tournament.endDate || '',
    enableLeaderboard: tournament.enableLeaderboard ?? true,
    enableBonus: tournament.enableBonus ?? true,
    visibility: tournament.visibility || 'private',
  });
  const [saving, setSaving] = useState(false);
  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await axios.patch(API(`/tournaments/${tournament.id}`), form);
      onChange(res.data.tournament);
      toast('Configuration saved', 'success');
    } catch {
      toast('Failed to save', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="adm-card adm-mt">
      <div className="adm-card-header"><h3 className="adm-card-title">Configuration</h3></div>
      <div className="adm-form-grid">
        <div className="adm-form-full">
          <label>Tournament Name</label>
          <input className="adm-input" value={form.name} onChange={e => setF('name', e.target.value)} />
        </div>
        <div className="adm-form-full">
          <label>Description</label>
          <textarea className="adm-textarea" rows={2} value={form.description}
            onChange={e => setF('description', e.target.value)} />
        </div>
        <div>
          <label>Start Date & Time</label>
          <input className="adm-input" type="datetime-local" value={form.startDate}
            onChange={e => setF('startDate', e.target.value)} />
        </div>
        <div>
          <label>End Date & Time</label>
          <input className="adm-input" type="datetime-local" value={form.endDate}
            onChange={e => setF('endDate', e.target.value)} />
        </div>
        <div>
          <label>Visibility</label>
          <select className="adm-select" value={form.visibility} onChange={e => setF('visibility', e.target.value)}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div className="adm-toggle-row adm-form-full">
          <div className="adm-toggle-item">
            <span>Enable Leaderboard</span>
            <button className={`adm-toggle ${form.enableLeaderboard ? 'on' : ''}`}
              onClick={() => setF('enableLeaderboard', !form.enableLeaderboard)} />
          </div>
          <div className="adm-toggle-item">
            <span>Enable Bonus Mode</span>
            <button className={`adm-toggle ${form.enableBonus ? 'on' : ''}`}
              onClick={() => setF('enableBonus', !form.enableBonus)} />
          </div>
        </div>
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--adm-border)' }}>
        <button className="adm-btn adm-btn-primary" onClick={save} disabled={saving}>
          {saving ? <RefreshCw size={14} className="spinning" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

function QuestionsTabInTournament({ tournament, onUpdate }: {
  tournament: Tournament;
  onUpdate: (ids: string[]) => void;
}) {
  const toast = useToast();
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerDiff, setPickerDiff] = useState<'all' | 'Easy' | 'Medium' | 'Hard'>('all');
  const [pickerSet, setPickerSet] = useState<'all' | 'A' | 'B' | 'Both' | 'Bonus' | 'none'>('all');

  const assignedIds = tournament.questionIds || [];

  useEffect(() => {
    axios.get(API('/problems'))
      .then(r => setAllProblems(r.data.problems || []))
      .finally(() => setLoading(false));
  }, []);

  const saveIds = async (ids: string[]) => {
    setSaving(true);
    try {
      await axios.put(API(`/tournaments/${tournament.id}/questions`), { questionIds: ids });
      onUpdate(ids);
      toast('Questions updated!', 'success');
    } catch {
      toast('Failed to save questions', 'error');
    }
    setSaving(false);
  };

  const addQuestion = (id: string) => {
    if (!assignedIds.includes(id)) saveIds([...assignedIds, id]);
  };

  const removeQuestion = (id: string) => {
    saveIds(assignedIds.filter(x => x !== id));
  };

  const assignedProblems = assignedIds
    .map(id => allProblems.find(p => p.id === id))
    .filter(Boolean) as Problem[];

  const pickerProblems = allProblems.filter(p => {
    if (assignedIds.includes(p.id)) return false;
    if (pickerDiff !== 'all' && p.difficulty !== pickerDiff) return false;
    if (pickerSet !== 'all' && p.problem_set !== pickerSet) return false;
    if (pickerSearch) {
      const q = pickerSearch.toLowerCase();
      return p.title.toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div className="adm-mt">
      {/* Assigned questions */}
      <div className="adm-card">
        <div className="adm-card-header">
          <h3 className="adm-card-title">Assigned Questions ({assignedIds.length})</h3>
          <button className="adm-btn adm-btn-primary" onClick={() => setShowPicker(v => !v)} disabled={saving}>
            {showPicker ? <X size={14} /> : <Plus size={14} />}
            {showPicker ? 'Close Picker' : 'Add Question'}
          </button>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>#</th><th>Title</th><th>Difficulty</th><th>Set</th><th>Test Cases</th><th></th></tr></thead>
            <tbody>
              {loading
                ? Array(3).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><Skeleton h={24} /></td></tr>)
                : assignedProblems.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--adm-text-muted)' }}>No questions assigned yet. Click "Add Question" to get started.</td></tr>
                  : assignedProblems.map((p, i) => (
                    <tr key={p.id}>
                      <td className="adm-muted">{i + 1}</td>
                      <td><strong>{p.title}</strong></td>
                      <td><span className={`adm-diff ${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span></td>
                      <td>
                        {p.problem_set && p.problem_set !== 'none'
                          ? <span className={`adm-set-badge adm-set-${p.problem_set.toLowerCase()}`}>
                              {p.problem_set === 'Both' ? 'A+B' : p.problem_set === 'Bonus' ? '★ Bonus' : `Set ${p.problem_set}`}
                            </span>
                          : <span className="adm-muted">—</span>}
                      </td>
                      <td>{p.tc_count || 0}</td>
                      <td>
                        <button className="adm-icon-btn adm-icon-btn-danger" onClick={() => removeQuestion(p.id)} disabled={saving} title="Remove">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Question picker */}
      {showPicker && (
        <div className="adm-card adm-mt adm-q-picker">
          <div className="adm-card-header">
            <h3 className="adm-card-title">Add Questions</h3>
            <span className="adm-hint">{pickerProblems.length} available</span>
          </div>
          <div className="adm-q-picker-filters">
            <div className="adm-search-wrap" style={{ flex: 1 }}>
              <Search size={14} className="adm-search-icon" />
              <input className="adm-search" placeholder="Search by title or tag…"
                value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
            </div>
            <div className="adm-quick-btns">
              {(['all', 'Easy', 'Medium', 'Hard'] as const).map(d => (
                <button key={d}
                  className={`adm-quick-btn ${pickerDiff === d ? 'active' : ''} ${d !== 'all' ? `adm-diff-btn-${d.toLowerCase()}` : ''}`}
                  onClick={() => setPickerDiff(d)}>{d === 'all' ? 'All Levels' : d}</button>
              ))}
            </div>
            <div className="adm-quick-btns">
              {([['all', 'All Sets'], ['A', 'Set A'], ['B', 'Set B'], ['Both', 'Both'], ['Bonus', 'Bonus'], ['none', 'Unassigned']] as const).map(([val, label]) => (
                <button key={val}
                  className={`adm-quick-btn adm-set-btn-${val.toLowerCase()} ${pickerSet === val ? 'active' : ''}`}
                  onClick={() => setPickerSet(val)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Title</th><th>Difficulty</th><th>Set</th><th>Test Cases</th><th></th></tr></thead>
              <tbody>
                {pickerProblems.length === 0
                  ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--adm-text-muted)' }}>No matching problems found</td></tr>
                  : pickerProblems.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.title}</strong>{p.tags?.length ? <span className="adm-muted" style={{ fontSize: '0.75rem', marginLeft: 6 }}>{p.tags.join(', ')}</span> : null}</td>
                      <td><span className={`adm-diff ${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span></td>
                      <td>
                        {p.problem_set && p.problem_set !== 'none'
                          ? <span className={`adm-set-badge adm-set-${p.problem_set.toLowerCase()}`}>
                              {p.problem_set === 'Both' ? 'A+B' : p.problem_set === 'Bonus' ? '★ Bonus' : `Set ${p.problem_set}`}
                            </span>
                          : <span className="adm-muted">—</span>}
                      </td>
                      <td>{p.tc_count || 0}</td>
                      <td>
                        <button className="adm-btn adm-btn-sm adm-btn-primary" onClick={() => addQuestion(p.id)} disabled={saving}>
                          <Plus size={13} /> Add
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyticsTabInTournament({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(API('/analytics')).then(r => setData(r.data)).finally(() => setLoading(false));
  }, [tournamentId]);

  const max = Math.max(...(data?.hourly?.map((h: any) => parseInt(h.submissions)) ?? [1]));

  return (
    <div className="adm-mt">
      <div className="adm-stat-grid">
        {loading ? Array(3).fill(0).map((_, i) => <div key={i} className="adm-stat-card"><Skeleton h={80} /></div>) : (
          <>
            <div className="adm-stat-card card-blue">
              <div className="adm-stat-icon"><Zap size={22} /></div>
              <div className="adm-stat-body">
                <div className="adm-stat-value">{data?.totalSubmissions}</div>
                <div className="adm-stat-label">Total Submissions</div>
              </div>
            </div>
            <div className="adm-stat-card card-green">
              <div className="adm-stat-icon"><CheckCircle2 size={22} /></div>
              <div className="adm-stat-body">
                <div className="adm-stat-value">{data?.accepted}</div>
                <div className="adm-stat-label">Accepted</div>
              </div>
            </div>
            <div className="adm-stat-card card-amber">
              <div className="adm-stat-icon"><Activity size={22} /></div>
              <div className="adm-stat-body">
                <div className="adm-stat-value">{data?.last24h}</div>
                <div className="adm-stat-label">Last 24h</div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="adm-two-col adm-mt">
        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">Hourly Trend (24h)</h3></div>
          <div className="adm-chart-bar">
            {loading ? <Skeleton h={100} /> : data?.hourly?.length === 0
              ? <div className="adm-empty-chart">No data yet</div>
              : data?.hourly?.map((h: any, i: number) => (
                <div key={i} className="adm-bar-wrap" title={`Hour ${h.hour}: ${h.submissions} submissions`}>
                  <div className="adm-bar" style={{ height: `${Math.max(4, (parseInt(h.submissions) / max) * 100)}%` }} />
                  <div className="adm-bar-label">{h.hour}</div>
                </div>
              ))
            }
          </div>
        </div>
        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">Per Problem Stats</h3></div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Problem</th><th>Difficulty</th><th>Submissions</th><th>Accepted</th></tr></thead>
              <tbody>
                {loading ? Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={4}><Skeleton h={20} /></td></tr>) :
                  data?.perProblem?.map((p: any) => (
                    <tr key={p.title}>
                      <td>{p.title}</td>
                      <td><span className={`adm-diff ${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span></td>
                      <td>{p.total_subs}</td>
                      <td>{p.accepted} {parseInt(p.total_subs) > 0 &&
                        <span className="adm-muted">({Math.round((parseInt(p.accepted) / parseInt(p.total_subs)) * 100)}%)</span>}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTabInTournament({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [lb, setLb] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const intervalRef = useRef<any>(null);

  const load = useCallback(() => {
    if (frozen) return;
    axios.get(API(`/tournaments/${tournamentId}/leaderboard`))
      .then(r => { setLb(r.data.leaderboard || []); })
      .finally(() => setLoading(false));
  }, [tournamentId, frozen]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 10000); // refresh every 10s
    return () => clearInterval(intervalRef.current);
  }, [load]);

  const downloadCSV = () => {
    const rows = ['Rank,Team,Room,Solved,Grid Cells'];
    lb.forEach(t => rows.push(`${t.rank},${t.teamName},${t.roomCode},${t.solved},${t.gridCells}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `leaderboard-${tournamentId}.csv`; a.click();
  };

  const resetLb = () => { setLb([]); load(); toast('Leaderboard refreshed', 'info'); };

  return (
    <div className="adm-card adm-mt">
      <div className="adm-card-header">
        <h3 className="adm-card-title">
          Live Leaderboard
          {!frozen && <span className="adm-live-dot" />}
        </h3>
        <div className="adm-action-row">
          <button className={`adm-btn adm-btn-ghost ${frozen ? 'adm-frozen-btn' : ''}`}
            onClick={() => { setFrozen(f => !f); toast(frozen ? 'Leaderboard live' : 'Leaderboard frozen', 'info'); }}>
            {frozen ? '▶ Unfreeze' : '⏸ Freeze'}
          </button>
          <button className="adm-btn adm-btn-ghost" onClick={resetLb}><RefreshCw size={14} /></button>
          <button className="adm-btn adm-btn-ghost" onClick={downloadCSV}><Download size={14} /> Export</button>
        </div>
      </div>
      {frozen && <div className="adm-freeze-banner">⏸ Leaderboard is frozen — scores not updating</div>}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Rank</th><th>Team</th><th>Room</th><th>Solved</th><th>Grid Cells</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><Skeleton h={24} /></td></tr>) :
              lb.map(t => (
                <tr key={`${t.roomCode}-${t.teamCode}`} className={t.rank <= 3 ? 'adm-top-row' : ''}>
                  <td>
                    <span className={`adm-rank adm-rank-${t.rank}`}>
                      {t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : `#${t.rank}`}
                    </span>
                  </td>
                  <td className="adm-team-name">{t.teamName}</td>
                  <td><span className="adm-mono">{t.roomCode}</span></td>
                  <td><strong>{t.solved}</strong></td>
                  <td>{t.gridCells}</td>
                  <td>
                    {t.winner === t.teamCode?.charAt(0)
                      ? <span className="adm-badge badge-accepted">Winner</span>
                      : t.phase === 'ended'
                        ? <span className="adm-badge badge-default">Ended</span>
                        : <span className="adm-badge badge-live">Playing</span>
                    }
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
        {!loading && lb.length === 0 && <div className="adm-empty">No teams have joined yet</div>}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   TOURNAMENTS LIST PAGE
──────────────────────────────────────────────────────────── */
function TournamentsPage({ onManage }: { onManage: (t: Tournament) => void }) {
  const toast = useToast();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tournament | null>(null);

  const load = () => {
    setLoading(true);
    axios.get(API('/tournaments')).then(r => setTournaments(r.data.tournaments || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const doDelete = async () => {
    if (!deleteTarget) return;
    await axios.delete(API(`/tournaments/${deleteTarget.id}`));
    setTournaments(p => p.filter(t => t.id !== deleteTarget.id));
    toast(`Deleted "${deleteTarget.name}"`, 'info');
    setDeleteTarget(null);
  };

  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <div>
          <h2 className="adm-page-title">Tournaments</h2>
          <p className="adm-page-sub">{tournaments.length} tournament{tournaments.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> Add Tournament
        </button>
      </div>

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Tournament Name</th>
                <th>Status</th>
                <th>Teams</th>
                <th>Questions</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array(4).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><Skeleton h={28} /></td></tr>)
                : tournaments.map(t => (
                  <tr key={t.id}>
                    <td>
                      <div className="adm-tournament-name">{t.name}</div>
                      {t.description && <div className="adm-muted adm-clamp">{t.description}</div>}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{t.pairs?.length * 2 || 0}</td>
                    <td>{t.questionCount}</td>
                    <td className="adm-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="adm-action-row">
                        <button className="adm-btn adm-btn-sm adm-btn-primary" onClick={() => onManage(t)}>
                          Manage
                        </button>
                        <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => setDeleteTarget(t)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading && tournaments.length === 0 && (
            <div className="adm-empty">
              <Trophy size={40} className="adm-empty-icon" />
              <div>No tournaments yet</div>
              <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Create First Tournament
              </button>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateTournamentModal
          onClose={() => setShowCreate(false)}
          onCreate={t => { setTournaments(p => [t, ...p]); setShowCreate(false); toast('Tournament created!', 'success'); }}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Tournament"
        msg={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   CREATE / EDIT PROBLEM MODAL
──────────────────────────────────────────────────────────── */
function ProblemModal({ problem, onClose, onSave }: {
  problem: Partial<Problem> | null;
  onClose: () => void;
  onSave: (p: Problem) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const isEdit = !!problem?.id;
  const [form, setForm] = useState({
    title: problem?.title || '',
    description: problem?.description || '',
    difficulty: problem?.difficulty || 'Easy',
    constraints: problem?.constraints || '',
    input_format: problem?.input_format || '',
    output_format: problem?.output_format || '',
    time_limit: problem?.time_limit || 2000,
    memory_limit: problem?.memory_limit || 256,
    is_published: problem?.is_published || false,
    problem_set: problem?.problem_set || 'none',
    tags: (problem?.tags || []).join(', '),
  });
  const [testcases, setTestcases] = useState<{ input: string; expected_output: string; is_sample: boolean }[]>([
    { input: '', expected_output: '', is_sample: true },
  ]);

  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const addTc = () => setTestcases(p => [...p, { input: '', expected_output: '', is_sample: false }]);
  const removeTc = (i: number) => setTestcases(p => p.filter((_, idx) => idx !== i));
  const setTc = (i: number, k: string, v: any) =>
    setTestcases(p => p.map((t, idx) => idx === i ? { ...t, [k]: v } : t));

  const submit = async () => {
    if (!form.title.trim()) { toast('Title is required', 'error'); return; }
    if (!form.description.trim()) { toast('Description is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        problem_set: form.problem_set,
        testcases: isEdit ? undefined : testcases.filter(t => t.expected_output.trim()),
      };
      const res = isEdit
        ? await axios.put(API(`/problems/${problem!.id}`), payload)
        : await axios.post(API('/problems'), payload);
      toast(isEdit ? 'Problem updated!' : 'Problem created!', 'success');
      onSave(isEdit ? res.data.problem : res.data.problem);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to save', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-modal adm-modal-xl" onClick={e => e.stopPropagation()}>
        <div className="adm-modal-header">
          <h3>{isEdit ? 'Edit Problem' : 'Create Problem'}</h3>
          <button className="adm-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="adm-problem-form">
          <div className="adm-form-grid">
            <div className="adm-form-full">
              <label>Question Title *</label>
              <input className="adm-input" placeholder="Two Sum" value={form.title} onChange={e => setF('title', e.target.value)} />
            </div>

            <div>
              <label>Difficulty</label>
              <div className="adm-quick-btns">
                {(['Easy', 'Medium', 'Hard'] as const).map(d => (
                  <button key={d} className={`adm-quick-btn adm-diff-btn-${d.toLowerCase()} ${form.difficulty === d ? 'active' : ''}`}
                    onClick={() => setF('difficulty', d)}>{d}</button>
                ))}
              </div>
            </div>

            <div>
              <label>Problem Set</label>
              <div className="adm-quick-btns">
                {([['none', 'None'], ['A', 'Set A'], ['B', 'Set B'], ['Both', 'Both'], ['Bonus', 'Bonus']] as const).map(([val, label]) => (
                  <button key={val}
                    className={`adm-quick-btn adm-set-btn-${val.toLowerCase()} ${form.problem_set === val ? 'active' : ''}`}
                    onClick={() => setF('problem_set', val)}>{label}</button>
                ))}
              </div>
              <div className="adm-hint">Assign to Set A, Set B, Both, Bonus, or leave unassigned</div>
            </div>

            <div>
              <label>Tags (comma-separated)</label>
              <input className="adm-input" placeholder="Array, Hash Table, Two Pointers" value={form.tags}
                onChange={e => setF('tags', e.target.value)} />
            </div>

            <div className="adm-form-full">
              <label>Description *</label>
              <textarea className="adm-textarea adm-textarea-lg" placeholder="Problem statement..." value={form.description}
                onChange={e => setF('description', e.target.value)} />
            </div>

            <div>
              <label>Input Format</label>
              <textarea className="adm-textarea" rows={3} placeholder="Describe input format..." value={form.input_format}
                onChange={e => setF('input_format', e.target.value)} />
            </div>

            <div>
              <label>Output Format</label>
              <textarea className="adm-textarea" rows={3} placeholder="Describe output format..." value={form.output_format}
                onChange={e => setF('output_format', e.target.value)} />
            </div>

            <div className="adm-form-full">
              <label>Constraints</label>
              <textarea className="adm-textarea" rows={2} placeholder="1 ≤ N ≤ 10^5" value={form.constraints}
                onChange={e => setF('constraints', e.target.value)} />
            </div>

            <div>
              <label>Time Limit (ms)</label>
              <input className="adm-input" type="number" value={form.time_limit} onChange={e => setF('time_limit', +e.target.value)} />
            </div>

            <div>
              <label>Memory Limit (MB)</label>
              <input className="adm-input" type="number" value={form.memory_limit} onChange={e => setF('memory_limit', +e.target.value)} />
            </div>

            <div className="adm-toggle-item">
              <span>Publish immediately</span>
              <button className={`adm-toggle ${form.is_published ? 'on' : ''}`}
                onClick={() => setF('is_published', !form.is_published)} />
            </div>
          </div>

          {!isEdit && (
            <div className="adm-tc-section">
              <div className="adm-tc-header">
                <h4>Test Cases</h4>
                <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={addTc}>
                  <Plus size={13} /> Add Test Case
                </button>
              </div>
              {testcases.map((tc, i) => (
                <div key={i} className="adm-tc-row">
                  <div className="adm-tc-num">{i + 1}</div>
                  <div className="adm-tc-fields">
                    <textarea className="adm-textarea adm-tc-textarea" placeholder="Input (stdin)"
                      value={tc.input} onChange={e => setTc(i, 'input', e.target.value)} />
                    <textarea className="adm-textarea adm-tc-textarea" placeholder="Expected Output *"
                      value={tc.expected_output} onChange={e => setTc(i, 'expected_output', e.target.value)} />
                  </div>
                  <label className="adm-checkbox">
                    <input type="checkbox" checked={tc.is_sample} onChange={e => setTc(i, 'is_sample', e.target.checked)} />
                    Sample
                  </label>
                  {testcases.length > 1 && (
                    <button className="adm-icon-btn adm-icon-btn-danger" onClick={() => removeTc(i)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="adm-modal-footer">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="adm-btn adm-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spinning" /> : <Save size={14} />}
            {saving ? 'Saving…' : isEdit ? 'Update Problem' : 'Create Problem'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   QUESTIONS PAGE
──────────────────────────────────────────────────────────── */
function QuestionsPage() {
  const toast = useToast();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Partial<Problem> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Problem | null>(null);
  const [search, setSearch] = useState('');
  const [setFilter, setSetFilter] = useState<'all' | 'A' | 'B' | 'Both' | 'Bonus' | 'none'>('all');
  const [processing, setProcessing] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ created: any[]; skipped: any[]; errors: any[] } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    axios.get(API('/problems')).then(r => setProblems(r.data.problems || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const doDelete = async () => {
    if (!deleteTarget) return;
    setProcessing(deleteTarget.id);
    await axios.delete(API(`/problems/${deleteTarget.id}`));
    setProblems(p => p.filter(x => x.id !== deleteTarget.id));
    toast(`Deleted "${deleteTarget.title}"`, 'info');
    setDeleteTarget(null);
    setProcessing(null);
  };

  const togglePublish = async (p: Problem) => {
    setProcessing(p.id);
    try {
      await axios.patch(API(`/problems/${p.id}/publish`), { is_published: !p.is_published });
      setProblems(prev => prev.map(x => x.id === p.id ? { ...x, is_published: !x.is_published } : x));
      toast(`"${p.title}" ${!p.is_published ? 'published' : 'unpublished'}`, 'success');
    } catch { toast('Failed to update', 'error'); }
    setProcessing(null);
  };

  const handleCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const csvContent = await file.text();
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const res = await axios.post(API('/problems/import-csv'), { csvContent });
      setCsvResult(res.data);
      toast(res.data.summary, res.data.errors?.length ? 'warning' : 'success');
      if (res.data.created?.length > 0) load();
    } catch (e: any) {
      toast(e.response?.data?.error || 'CSV import failed', 'error');
    }
    setCsvImporting(false);
  };

  const downloadCsvTemplate = () => {
    window.open(API('/problems/csv-template'), '_blank');
  };

  const filtered = problems.filter(p => {
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.difficulty.toLowerCase().includes(search.toLowerCase()) ||
      (p.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchSet = setFilter === 'all' || p.problem_set === setFilter;
    return matchSearch && matchSet;
  });

  const setCounts = {
    all: problems.length,
    A: problems.filter(p => p.problem_set === 'A').length,
    B: problems.filter(p => p.problem_set === 'B').length,
    Both: problems.filter(p => p.problem_set === 'Both').length,
    Bonus: problems.filter(p => p.problem_set === 'Bonus').length,
    none: problems.filter(p => !p.problem_set || p.problem_set === 'none').length,
  };

  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <div>
          <h2 className="adm-page-title">Questions</h2>
          <p className="adm-page-sub">{problems.length} problems · {problems.filter(p => p.is_published).length} published</p>
        </div>
        <div className="adm-action-row">
          <input type="file" accept=".csv" ref={csvInputRef} onChange={handleCsvImport}
            style={{ display: 'none' }} />
          <button className="adm-btn adm-btn-ghost" onClick={downloadCsvTemplate} title="Download CSV Template">
            <Download size={14} /> CSV Template
          </button>
          <button className="adm-btn adm-btn-ghost" onClick={() => csvInputRef.current?.click()}
            disabled={csvImporting} title="Import problems from CSV">
            {csvImporting ? <RefreshCw size={14} className="spinning" /> : <Upload size={14} />}
            {csvImporting ? 'Importing…' : 'Import CSV'}
          </button>
          <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Add Question
          </button>
        </div>
      </div>

      {/* CSV import result summary */}
      {csvResult && (
        <div className="adm-csv-result">
          <div className="adm-csv-result-header">
            <strong>CSV Import Result</strong>
            <button className="adm-icon-btn" onClick={() => setCsvResult(null)}><X size={14} /></button>
          </div>
          <div className="adm-csv-chips">
            <span className="adm-csv-chip ok">✅ {csvResult.created.length} created</span>
            <span className="adm-csv-chip skip">⏭ {csvResult.skipped.length} skipped</span>
            {csvResult.errors.length > 0 && <span className="adm-csv-chip err">❌ {csvResult.errors.length} errors</span>}
          </div>
          {csvResult.skipped.length > 0 && (
            <div className="adm-csv-detail">
              {csvResult.skipped.map((s: any) => <div key={s.title} className="adm-csv-skip">⏭ <strong>{s.title}</strong>: {s.reason}</div>)}
            </div>
          )}
          {csvResult.errors.length > 0 && (
            <div className="adm-csv-detail">
              {csvResult.errors.map((e: any) => <div key={e.title} className="adm-csv-err">❌ <strong>{e.title}</strong>: {e.reason}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Set filter tabs */}
      <div className="adm-set-filter">
        <Filter size={13} className="adm-muted" />
        {([['all', 'All Sets'], ['A', 'Set A'], ['B', 'Set B'], ['Both', 'Both'], ['Bonus', 'Bonus'], ['none', 'Unassigned']] as const).map(([val, label]) => (
          <button key={val}
            className={`adm-set-tab ${setFilter === val ? 'active' : ''} adm-set-tab-${val.toLowerCase()}`}
            onClick={() => setSetFilter(val)}>
            {label}
            <span className="adm-set-tab-count">{setCounts[val]}</span>
          </button>
        ))}
      </div>

      <div className="adm-card">
        <div className="adm-card-header">
          <div className="adm-search-wrap">
            <Search size={14} className="adm-search-icon" />
            <input className="adm-search" placeholder="Search problems..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Difficulty</th>
                <th>Set</th>
                <th>Test Cases</th>
                <th>Submissions</th>
                <th>AC Rate</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={9}><Skeleton h={26} /></td></tr>)
                : filtered.map((p, i) => (
                  <tr key={p.id}>
                    <td className="adm-muted">{i + 1}</td>
                    <td>
                      <div className="adm-problem-title">{p.title}</div>
                      {p.tags?.length > 0 && (
                        <div className="adm-tags">
                          {p.tags.slice(0, 3).map(t => <span key={t} className="adm-tag">{t}</span>)}
                        </div>
                      )}
                    </td>
                    <td><span className={`adm-diff ${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span></td>
                    <td>
                      {p.problem_set && p.problem_set !== 'none'
                        ? <span className={`adm-set-badge adm-set-${p.problem_set.toLowerCase()}`}>{p.problem_set === 'Both' ? 'A+B' : p.problem_set === 'Bonus' ? '★ Bonus' : `Set ${p.problem_set}`}</span>
                        : <span className="adm-muted" style={{ fontSize: '0.75rem' }}>—</span>}
                    </td>
                    <td>{p.tc_count || 0}</td>
                    <td>{p.sub_count || 0}</td>
                    <td>{parseInt(p.sub_count as any) > 0
                      ? `${Math.round((parseInt(p.ac_count as any) / parseInt(p.sub_count as any)) * 100)}%`
                      : '—'}
                    </td>
                    <td>
                      <button
                        className={`adm-badge badge-clickable ${p.is_published ? 'badge-accepted' : 'badge-default'}`}
                        onClick={() => togglePublish(p)}
                        disabled={processing === p.id}
                        title={p.is_published ? 'Click to unpublish' : 'Click to publish'}
                      >
                        {processing === p.id ? <RefreshCw size={10} className="spinning" /> :
                          p.is_published ? '✅ Published' : '⬜ Draft'}
                      </button>
                    </td>
                    <td>
                      <div className="adm-action-row">
                        <button className="adm-btn adm-btn-sm adm-btn-ghost" onClick={() => setEditTarget(p)}
                          title="Edit">
                          <Edit3 size={13} />
                        </button>
                        <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => setDeleteTarget(p)}
                          title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && (
            <div className="adm-empty">
              <FileCode size={40} className="adm-empty-icon" />
              <div>No problems found{setFilter !== 'all' ? ` in ${setFilter === 'none' ? 'Unassigned' : setFilter === 'Both' ? 'Both Sets' : `Set ${setFilter}`}` : ''}</div>
            </div>
          )}
        </div>
      </div>

      {(showCreate || editTarget) && (
        <ProblemModal
          problem={editTarget}
          onClose={() => { setShowCreate(false); setEditTarget(null); }}
          onSave={savedP => {
            if (editTarget) {
              setProblems(p => p.map(x => x.id === savedP.id ? { ...x, ...savedP } : x));
            } else {
              setProblems(p => [savedP, ...p]);
            }
            setShowCreate(false); setEditTarget(null);
          }}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Problem"
        msg={`Delete "${deleteTarget?.title}"? All test cases and submissions for this problem will also be deleted.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   GLOBAL LEADERBOARD PAGE
──────────────────────────────────────────────────────────── */
function LeaderboardPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [lb, setLb] = useState<LeaderboardEntry[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    axios.get(API('/tournaments')).then(r => {
      const ts = r.data.tournaments || [];
      setTournaments(ts);
      if (ts.length > 0) setSelected(ts[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    axios.get(API(`/tournaments/${selected}/leaderboard`))
      .then(r => { setLb(r.data.leaderboard || []); })
      .finally(() => setLoading(false));
  }, [selected]);

  useEffect(() => {
    if (!selected || frozen) return;
    const iv = setInterval(() => {
      axios.get(API(`/tournaments/${selected}/leaderboard`))
        .then(r => { setLb(r.data.leaderboard || []); setMeta(r.data.tournament); });
    }, 10000);
    return () => clearInterval(iv);
  }, [selected, frozen]);

  const downloadCSV = () => {
    const rows = ['Rank,Team,Room,Solved,Grid Cells,Status'];
    lb.forEach(t => rows.push(`${t.rank},"${t.teamName}",${t.roomCode},${t.solved},${t.gridCells},${t.phase}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `leaderboard-${selected}.csv`; a.click();
  };

  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <div>
          <h2 className="adm-page-title">Leaderboard</h2>
          <p className="adm-page-sub">{meta ? meta.name : 'Select a tournament'}</p>
        </div>
        <div className="adm-action-row">
          <select className="adm-select" value={selected} onChange={e => setSelected(e.target.value)}>
            {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className={`adm-btn adm-btn-ghost ${frozen ? 'adm-frozen-btn' : ''}`}
            onClick={() => { setFrozen(f => !f); toast(frozen ? 'Live again' : 'Frozen', 'info'); }}>
            {frozen ? '▶ Unfreeze' : '⏸ Freeze'}
          </button>
          <button className="adm-btn adm-btn-ghost" onClick={downloadCSV}><Download size={14} /> Export</button>
        </div>
      </div>

      {frozen && <div className="adm-freeze-banner">⏸ Leaderboard is frozen</div>}

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Rank</th><th>Team</th><th>Room</th><th>Solved</th><th>Grid Cells</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading ? Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><Skeleton h={28} /></td></tr>) :
                lb.map(t => (
                  <tr key={`${t.roomCode}-${t.teamCode}`} className={t.rank <= 3 ? 'adm-top-row' : ''}>
                    <td>
                      <span className={`adm-rank adm-rank-${t.rank}`}>
                        {t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : `#${t.rank}`}
                      </span>
                    </td>
                    <td className="adm-team-name">{t.teamName}</td>
                    <td><span className="adm-mono">{t.roomCode}</span></td>
                    <td><strong>{t.solved}</strong></td>
                    <td>{t.gridCells}</td>
                    <td>
                      {t.phase === 'ended'
                        ? <span className="adm-badge badge-default">Ended</span>
                        : <span className="adm-badge badge-live">Playing</span>}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          {!loading && lb.length === 0 && (
            <div className="adm-empty">
              {tournaments.length === 0 ? 'No tournaments found' : 'No teams have joined yet'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   SETTINGS PAGE
──────────────────────────────────────────────────────────── */
function SettingsPage({ dark, setDark }: { dark: boolean; setDark: (v: boolean) => void }) {
  const toast = useToast();
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${(import.meta.env.VITE_API_URL as string) || ''}/health`)
      .then(r => setHealth(r.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="adm-page">
      <div className="adm-page-header">
        <div>
          <h2 className="adm-page-title">Settings</h2>
          <p className="adm-page-sub">Platform configuration</p>
        </div>
      </div>

      <div className="adm-two-col">
        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">Appearance</h3></div>
          <div style={{ padding: '20px' }}>
            <div className="adm-toggle-item" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>Dark Mode</div>
                <div className="adm-muted" style={{ fontSize: '0.8rem' }}>Toggle dark/light theme</div>
              </div>
              <button className={`adm-toggle ${dark ? 'on' : ''}`} onClick={() => setDark(!dark)} />
            </div>
          </div>
        </div>

        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">System Health</h3></div>
          <div style={{ padding: '20px' }}>
            {loading ? <Skeleton h={80} /> : health ? (
              <div className="adm-health-list">
                {[
                  { label: 'API Server', status: health.api === 'up' },
                  { label: 'PostgreSQL', status: health.db === 'up' },
                  { label: 'Redis / Queue', status: health.redis === 'up' },
                ].map(s => (
                  <div key={s.label} className="adm-health-row">
                    <span>{s.label}</span>
                    <span className={s.status ? 'adm-status-ok' : 'adm-status-fail'}>
                      {s.status ? '🟢 Online' : '🔴 Offline'}
                    </span>
                  </div>
                ))}
                <div className="adm-health-row">
                  <span>Uptime</span>
                  <span className="adm-muted">{Math.floor((health.uptime || 0) / 60)}m {(health.uptime || 0) % 60}s</span>
                </div>
              </div>
            ) : <div className="adm-muted">Could not load health data</div>}
          </div>
        </div>

        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">Platform Info</h3></div>
          <div style={{ padding: '20px' }}>
            <div className="adm-health-list">
              {[
                { label: 'Platform', value: 'CodeArena' },
                { label: 'Environment', value: import.meta.env.MODE || 'production' },
                { label: 'API URL', value: (import.meta.env.VITE_API_URL as string) || '(origin)' },
              ].map(s => (
                <div key={s.label} className="adm-health-row">
                  <span>{s.label}</span>
                  <span className="adm-mono adm-muted">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="adm-card">
          <div className="adm-card-header"><h3 className="adm-card-title">Quick Actions</h3></div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="adm-btn adm-btn-ghost" onClick={() => { window.location.href = '/admin_panel'; }}>
              <Swords size={14} /> Open Game Control Panel
            </button>
            <button className="adm-btn adm-btn-ghost" onClick={() => { window.open('/compiler', '_blank'); }}>
              <FileCode size={14} /> Open Compiler Playground
            </button>
            <button className="adm-btn adm-btn-ghost" onClick={() => toast('Cache cleared (Redis TTL reset)', 'success')}>
              <RefreshCw size={14} /> Clear Cache (simulated)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MAIN ADMIN DASHBOARD
──────────────────────────────────────────────────────────── */
type NavKey = 'dashboard' | 'tournaments' | 'questions' | 'leaderboard' | 'settings';

const NAV_ITEMS: { key: NavKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard',   label: 'Dashboard',   icon: <LayoutDashboard size={18} /> },
  { key: 'tournaments', label: 'Tournaments',  icon: <Trophy size={18} /> },
  { key: 'questions',   label: 'Questions',    icon: <FileCode size={18} /> },
  { key: 'leaderboard', label: 'Leaderboard',  icon: <BarChart3 size={18} /> },
  { key: 'settings',    label: 'Settings',     icon: <Settings size={18} /> },
];

export default function AdminDashboard() {
  const [nav, setNav] = useState<NavKey>('dashboard');
  const [managedTournament, setManagedTournament] = useState<Tournament | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(() => localStorage.getItem('adm_dark') !== 'false');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-adm-theme', dark ? 'dark' : 'light');
    localStorage.setItem('adm_dark', String(dark));
  }, [dark]);

  const addToast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++toastId.current;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  const handleNav = (key: NavKey) => {
    setNav(key);
    setManagedTournament(null);
  };

  return (
    <ToastCtx.Provider value={addToast}>
      <div className={`adm-root ${sidebarOpen ? '' : 'adm-sidebar-collapsed'}`}>
        {/* ── Sidebar ── */}
        <aside className="adm-sidebar">
          <div className="adm-sidebar-brand">
            <Swords size={20} color="#3b82f6" />
            {sidebarOpen && <span className="adm-brand-text">CodeArena</span>}
          </div>

          <nav className="adm-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.key}
                className={`adm-nav-item ${nav === item.key && !managedTournament ? 'active' : ''}`}
                onClick={() => handleNav(item.key)}
                title={!sidebarOpen ? item.label : undefined}
              >
                <span className="adm-nav-icon">{item.icon}</span>
                {sidebarOpen && <span className="adm-nav-label">{item.label}</span>}
              </button>
            ))}
          </nav>

          <div className="adm-sidebar-footer">
            <button className="adm-nav-item" onClick={() => setDark(d => !d)} title="Toggle theme">
              <span className="adm-nav-icon">{dark ? <Sun size={18} /> : <Moon size={18} />}</span>
              {sidebarOpen && <span className="adm-nav-label">{dark ? 'Light Mode' : 'Dark Mode'}</span>}
            </button>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="adm-main">
          {/* Top bar */}
          <header className="adm-topbar">
            <div className="adm-topbar-left">
              <button className="adm-icon-btn" onClick={() => setSidebarOpen(o => !o)}>
                <Menu size={18} />
              </button>
              <div className="adm-breadcrumb">
                <span className="adm-muted">Admin</span>
                <ChevronRight size={14} className="adm-muted" />
                <span>{managedTournament ? (
                  <><span className="adm-muted" style={{ cursor: 'pointer' }} onClick={() => { setNav('tournaments'); setManagedTournament(null); }}>Tournaments</span>
                    {' '}<ChevronRight size={14} className="adm-muted" /> {managedTournament.name}</>
                ) : NAV_ITEMS.find(n => n.key === nav)?.label}</span>
              </div>
            </div>
            <div className="adm-topbar-right">
              <div className="adm-admin-badge">
                <Shield size={14} color="#3b82f6" />
                <span>Admin</span>
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="adm-content">
            {managedTournament ? (
              <ManageTournament
                tournament={managedTournament}
                onBack={() => { setManagedTournament(null); setNav('tournaments'); }}
              />
            ) : (
              <>
                {nav === 'dashboard'   && <DashboardPage />}
                {nav === 'tournaments' && <TournamentsPage onManage={t => setManagedTournament(t)} />}
                {nav === 'questions'   && <QuestionsPage />}
                {nav === 'leaderboard' && <LeaderboardPage />}
                {nav === 'settings'    && <SettingsPage dark={dark} setDark={setDark} />}
              </>
            )}
          </div>
        </div>

        {/* Toast container */}
        <div className="adm-toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`adm-toast adm-toast-${t.type}`}>
              {t.type === 'success' && <CheckCircle2 size={16} />}
              {t.type === 'error'   && <XCircle size={16} />}
              {t.type === 'warning' && <AlertTriangle size={16} />}
              {t.type === 'info'    && <Activity size={16} />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}
