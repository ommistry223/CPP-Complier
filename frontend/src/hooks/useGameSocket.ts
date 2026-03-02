import { useEffect, useRef, useCallback, useState } from 'react';

type MessageHandler = (msg: { type: string;[key: string]: any }) => void;

// Derive WS URL from VITE_API_URL (set in run.bat for native dev).
// In Docker the nginx load-balancer proxies /ws on the same origin, so
// we fall back to window.location.origin — keeps both modes working.
const _RAW_API = import.meta.env.VITE_API_URL;
const API_URL  = _RAW_API || window.location.origin;
const WS_URL   = API_URL.replace(/^http/, 'ws') + '/ws';

export function useGameSocket(onMessage: MessageHandler) {
    const wsRef = useRef<WebSocket | null>(null);
    const onMessageRef = useRef<MessageHandler>(onMessage);
    const [connected, setConnected] = useState(false);
    const queueRef = useRef<{ type: string; payload: any }[]>([]);
    const reconnectTimerRef = useRef<any>(null);
    onMessageRef.current = onMessage;

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

        console.log('[WS] Connecting to:', WS_URL);
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[WS] Connected');
            setConnected(true);
            // Flush queue once connected
            while (queueRef.current.length > 0) {
                const msg = queueRef.current.shift();
                if (msg) ws.send(JSON.stringify(msg));
            }
        };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                onMessageRef.current(msg);
            } catch { /* ignore */ }
        };

        ws.onclose = () => {
            console.log('[WS] Disconnected. Retrying in 2s...');
            setConnected(false);
            if (!reconnectTimerRef.current) {
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectTimerRef.current = null;
                    connect();
                }, 2000);
            }
        };

        ws.onerror = (e) => {
            console.error('[WS] Error', e);
        };
    }, []);

    useEffect(() => {
        connect();
        return () => {
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    const send = useCallback((type: string, payload: Record<string, any> = {}) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, payload }));
        } else {
            // Buffer the message if still connecting, don't just drop it!
            console.log('[WS] Buffering message (still connecting):', type);
            queueRef.current.push({ type, payload });
            if (ws?.readyState !== WebSocket.CONNECTING) connect();
        }
    }, [connect]);

    return { send, connected };
}
