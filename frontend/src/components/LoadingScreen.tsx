import { useEffect, useState } from 'react';
import './LoadingScreen.css';

/* ─────────────────────────────────────────────────────────
   Animated Tic-Tac-Toe SVG
   One-shot 3-second sequence:
     0.15s  → grid lines draw in (4 lines, staggered)
     0.70s  → O top-left appears
     0.90s  → X top-right appears
     1.05s  → O mid-right appears
     1.20s  → X center appears
     1.40s  → X bottom-left (winning piece) appears
     1.60s  → gold win-line sweeps diagonal
     2.50s  → short hold
     2.80s  → fade out begins
     3.20s  → onDone() callback fires
───────────────────────────────────────────────────────── */
function TicTacToeSVG() {
    return (
        <div className="ls-svg-wrap">
            <div className="ls-glow-ring" />
            <svg className="ls-svg" viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    {/* Blue-cyan glow for X */}
                    <filter id="ls-fx" x="-90%" y="-90%" width="280%" height="280%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b" />
                        <feFlood floodColor="#60a5fa" floodOpacity="1" result="c" />
                        <feComposite in="c" in2="b" operator="in" result="s" />
                        <feMerge><feMergeNode in="s" /><feMergeNode in="s" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    {/* Purple glow for O */}
                    <filter id="ls-fo" x="-90%" y="-90%" width="280%" height="280%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b" />
                        <feFlood floodColor="#a78bfa" floodOpacity="1" result="c" />
                        <feComposite in="c" in2="b" operator="in" result="s" />
                        <feMerge><feMergeNode in="s" /><feMergeNode in="s" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    {/* Gold glow for win line */}
                    <filter id="ls-fw" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="b" />
                        <feFlood floodColor="#f59e0b" floodOpacity="1" result="c" />
                        <feComposite in="c" in2="b" operator="in" result="s" />
                        <feMerge><feMergeNode in="s" /><feMergeNode in="s" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    {/* Subtle blue glow for grid */}
                    <filter id="ls-fg" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b" />
                        <feFlood floodColor="#3b82f6" floodOpacity="0.6" result="c" />
                        <feComposite in="c" in2="b" operator="in" result="s" />
                        <feMerge><feMergeNode in="s" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <linearGradient id="ls-xgrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#93c5fd" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                    <linearGradient id="ls-ograd" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#c4b5fd" />
                        <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                </defs>

                {/* ── Grid lines — using <path> so pathLength="1" works reliably ── */}
                <path className="ls-gl ls-gl1" pathLength="1"
                    d="M 30 100 L 270 100"
                    stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" filter="url(#ls-fg)" />
                <path className="ls-gl ls-gl2" pathLength="1"
                    d="M 30 200 L 270 200"
                    stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" filter="url(#ls-fg)" />
                <path className="ls-gl ls-gl3" pathLength="1"
                    d="M 100 30 L 100 270"
                    stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" filter="url(#ls-fg)" />
                <path className="ls-gl ls-gl4" pathLength="1"
                    d="M 200 30 L 200 270"
                    stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" filter="url(#ls-fg)" />

                {/* ── Grid intersection glow nodes ── */}
                <circle className="ls-node" cx="100" cy="100" r="4" fill="#2563eb" />
                <circle className="ls-node" cx="200" cy="100" r="4" fill="#2563eb" />
                <circle className="ls-node" cx="100" cy="200" r="4" fill="#2563eb" />
                <circle className="ls-node" cx="200" cy="200" r="4" fill="#2563eb" />

                {/* ── O top-left cell (50,50) — pathLength="1" for reliable draw ── */}
                <circle className="ls-circle ls-o1" cx="50" cy="50" r="28"
                    pathLength="1"
                    stroke="url(#ls-ograd)" strokeWidth="5.5" fill="none" filter="url(#ls-fo)" />

                {/* ── X top-right cell (250,50) ── */}
                <g className="ls-xsym ls-x1" filter="url(#ls-fx)">
                    <line x1="224" y1="24" x2="276" y2="76" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                    <line x1="276" y1="24" x2="224" y2="76" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                </g>

                {/* ── O mid-right cell (250,150) ── */}
                <circle className="ls-circle ls-o2" cx="250" cy="150" r="28"
                    pathLength="1"
                    stroke="url(#ls-ograd)" strokeWidth="5.5" fill="none" filter="url(#ls-fo)" />

                {/* ── X center cell (150,150) ── */}
                <g className="ls-xsym ls-x2" filter="url(#ls-fx)">
                    <line x1="124" y1="124" x2="176" y2="176" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                    <line x1="176" y1="124" x2="124" y2="176" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                </g>

                {/* ── X bottom-left cell (50,250) — WINNING ── */}
                <g className="ls-xsym ls-x3" filter="url(#ls-fx)">
                    <line x1="24" y1="224" x2="76" y2="276" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                    <line x1="76" y1="224" x2="24" y2="276" stroke="url(#ls-xgrad)" strokeWidth="5.5" strokeLinecap="round" />
                </g>

                {/* ── Win line — <path> so pathLength="1" sweep works ── */}
                <path className="ls-win" pathLength="1"
                    d="M 265 35 L 35 265"
                    stroke="#f59e0b" strokeWidth="4.5" strokeLinecap="round" fill="none" filter="url(#ls-fw)" />
            </svg>
        </div>
    );
}

export default function LoadingScreen({ onDone }: { onDone: () => void }) {
    const [fading, setFading] = useState(false);

    useEffect(() => {
        // Start fade-out at 2.8s, call onDone at 3.3s
        const fadeTimer = setTimeout(() => setFading(true), 2800);
        const doneTimer = setTimeout(onDone, 3300);
        return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
    }, [onDone]);

    return (
        <div className={`ls-root${fading ? ' ls-fading' : ''}`}>
            {/* Ambient background orbs */}
            <div className="ls-orb ls-orb1" />
            <div className="ls-orb ls-orb2" />
            <TicTacToeSVG />
            <p className="ls-brand-label">Code Tic-Tac-Toe</p>
            <div className="ls-spinner-row">
                <span className="ls-dot ls-d1" />
                <span className="ls-dot ls-d2" />
                <span className="ls-dot ls-d3" />
            </div>
        </div>
    );
}
