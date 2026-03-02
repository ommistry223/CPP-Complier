import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Trophy, RefreshCw, ArrowLeft, Medal, Zap, Users, CheckSquare } from 'lucide-react';
import './Leaderboard.css';

// Strip all emoji / non-ASCII decoration from team names
function stripEmoji(str: string): string {
    return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();
}

interface LeaderboardEntry {
    rank: number;
    pairNo: number;
    teamName: string;
    teamId: 'A' | 'B';
    score: number;
    solved: number;
    roomCode: string;
    isWinner: boolean;
    phase: string;
}

interface TournamentMeta {
    id: string;
    name: string;
    pairs: number;
    createdAt: string;
}

const RANK_COLORS: Record<number, { bg: string; color: string; border: string }> = {
    1: { bg: '#fef9c3', color: '#a16207', border: '#fde047' },
    2: { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
    3: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
};
const MAX_PROBLEMS = 6;
const REFRESH_INTERVAL = 30_000;

// Render N filled + (MAX-N) empty tick dots
function SolvedTicks({ solved }: { solved: number }) {
    return (
        <div className="lb-ticks">
            {Array.from({ length: MAX_PROBLEMS }, (_, i) => (
                <span key={i} className={`lb-tick ${i < solved ? 'filled' : 'empty'}`} title={i < solved ? 'Solved' : 'Unsolved'} />
            ))}
            <span className="lb-tick-count">{solved}/{MAX_PROBLEMS}</span>
        </div>
    );
}

export default function Leaderboard() {
    const { tournamentId } = useParams<{ tournamentId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isAdmin = searchParams.get('admin') === '1';

    const [meta, setMeta] = useState<TournamentMeta | null>(null);
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchLeaderboard = useCallback(async () => {
        if (!tournamentId) return;
        try {
            const res = await axios.get(`${import.meta.env.VITE_API_URL || ''}/api/tournament/${tournamentId}/leaderboard`);
            setMeta(res.data.tournament);
            setEntries(res.data.leaderboard || []);
            setLastUpdated(new Date());
            setError('');
        } catch (e: any) {
            setError(e.response?.data?.error || 'Failed to load leaderboard');
        } finally {
            setLoading(false);
        }
    }, [tournamentId]);

    useEffect(() => {
        fetchLeaderboard();
        const interval = setInterval(fetchLeaderboard, REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchLeaderboard]);

    const totalTeams = entries.length;
    const activeRooms = [...new Set(entries.map(e => e.roomCode))].filter(r => {
        const roomEntries = entries.filter(e => e.roomCode === r);
        return roomEntries.some(e => e.phase === 'playing');
    }).length;

    return (
        <div className="lb-root">
            <div className="lb-orb lb-orb-1" />
            <div className="lb-orb lb-orb-2" />

            <div className="lb-container">
                {/* Header */}
                <div className="lb-header">
                    <button className="lb-back-btn" onClick={() => navigate('/admin_panel')}>
                        <ArrowLeft size={16} /> Back
                    </button>
                    <div className="lb-title-section">
                        <div className="lb-icon"><Trophy size={28} color="#2563eb" /></div>
                        <div>
                            <h1 className="lb-title">{meta?.name || 'Tournament Leaderboard'}</h1>
                            <div className="lb-meta-row">
                                {meta && <span className="lb-meta-pill"><Users size={12} /> {totalTeams} teams</span>}
                                {activeRooms > 0 && (
                                    <span className="lb-meta-pill active">
                                        <Zap size={12} /> {activeRooms} rooms live
                                    </span>
                                )}
                                {lastUpdated && (
                                    <span className="lb-meta-pill">
                                        Updated {lastUpdated.toLocaleTimeString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button className="lb-refresh-btn" onClick={fetchLeaderboard} disabled={loading}>
                        <RefreshCw size={15} className={loading ? 'spinning' : ''} />
                        Refresh
                    </button>
                </div>

                {/* Content */}
                {loading && entries.length === 0 ? (
                    <div className="lb-loading">
                        <RefreshCw size={22} className="spinning" />
                        <span>Loading tournament data...</span>
                    </div>
                ) : error ? (
                    <div className="lb-error">{error}</div>
                ) : (
                    <div className="lb-card">
                        {/* Top 3 podium */}
                        {entries.length >= 3 && (
                            <div className="lb-podium">
                                {[entries[1], entries[0], entries[2]].filter(Boolean).map((e, i) => {
                                    const pos = [2, 1, 3][i];
                                    const rc = RANK_COLORS[pos] || RANK_COLORS[3];
                                    return (
                                        <div key={e.rank} className={`lb-podium-slot pos-${pos}`}>
                                            <div className="lb-podium-rank-badge" style={{ background: rc.bg, color: rc.color, border: `1.5px solid ${rc.border}` }}>{pos}</div>
                                            <div className="lb-podium-name">{stripEmoji(e.teamName)}</div>
                                            {isAdmin && (
                                                <div className="lb-podium-solved">
                                                    <CheckSquare size={11} />
                                                    {e.solved} solved
                                                </div>
                                            )}
                                            <div className="lb-podium-block" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Full table */}
                        <div className="lb-table-wrap">
                            <table className="lb-table">
                                <thead>
                                    <tr>
                                        <th className="lb-th-rank">#</th>
                                        <th>Team</th>
                                        {isAdmin && <th className="lb-th-num">Solved</th>}
                                        <th className="lb-th-num">Pair</th>
                                        <th className="lb-th-num">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map(entry => {
                                        const rc = RANK_COLORS[entry.rank];
                                        return (
                                            <tr key={`${entry.roomCode}-${entry.teamId}`}
                                                className={`lb-row ${entry.isWinner ? 'winner' : ''} ${entry.rank <= 3 ? 'top3' : ''}`}
                                            >
                                                <td className="lb-td-rank">
                                                    {rc
                                                        ? <span className="lb-rank-badge" style={{ background: rc.bg, color: rc.color, border: `1.5px solid ${rc.border}` }}>{entry.rank}</span>
                                                        : <span className="lb-rank-num">{entry.rank}</span>
                                                    }
                                                </td>
                                                <td>
                                                    <div className="lb-team-cell">
                                                        <div className="lb-team-dot" style={{ background: entry.teamId === 'A' ? '#2563eb' : '#7c3aed' }} />
                                                        <span className="lb-team-name">{stripEmoji(entry.teamName) || `Team ${entry.teamId} (Pair ${entry.pairNo})`}</span>
                                                        {entry.isWinner && <span className="lb-winner-badge">Winner</span>}
                                                    </div>
                                                </td>
                                                {isAdmin && (
                                                    <td className="lb-td-num">
                                                        <SolvedTicks solved={entry.solved} />
                                                    </td>
                                                )}
                                                <td className="lb-td-num lb-pair-no">#{entry.pairNo}</td>
                                                <td className="lb-td-num">
                                                    <span className={`lb-phase-badge phase-${entry.phase}`}>
                                                        {entry.phase === 'playing' ? 'Live' :
                                                         entry.phase === 'ended'   ? 'Done' :
                                                         entry.phase === 'waiting' ? 'Wait' : entry.phase}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {entries.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 5 : 4} className="lb-empty">No data yet. Games may not have started.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="lb-footer">
                            <Medal size={14} color="#94a3b8" />
                            <span>Auto-refreshes every 30 seconds · Tournament ID: <code>{tournamentId}</code></span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
