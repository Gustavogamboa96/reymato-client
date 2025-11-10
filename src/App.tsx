import { useEffect, useRef, useState, useCallback } from 'react';
import GameScene from './GameScene.ts';
import RcJoystickWrapper from './ui/RcJoystickWrapper.tsx';
import './App.css';

interface GameState {
  connected: boolean;
  nickname: string;
  showNicknameInput: boolean;
  currentRole: string;
  timeAsRey: number;
  matchTime: number;
  leaderboard: Array<{ nickname: string; timeAsRey: number }>;
  showLeaderboard: boolean;
  waitingForServe: boolean;
  currentServer: string;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameSceneRef = useRef<GameScene | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    connected: false,
    nickname: '',
    showNicknameInput: true,
    currentRole: 'queue',
    timeAsRey: 0,
    matchTime: 0,
    leaderboard: [],
    showLeaderboard: false,
    waitingForServe: false,
    currentServer: ''
  });

  const [input, setInput] = useState({
    move: [0, 0] as [number, number],
    jump: false,
    action: null as 'kick' | 'head' | 'serve' | null
  });

  // Track separate sources to resolve precedence (joystick wins while active)
  const joystickVecRef = useRef<[number, number]>([0, 0]);
  const keyboardVecRef = useRef<[number, number]>([0, 0]);
  const lastSourceRef = useRef<'joystick' | 'keyboard' | null>(null);
  const currentRoleRef = useRef<string>('queue');

  // Keep currentRoleRef in sync with gameState.currentRole
  useEffect(() => {
    currentRoleRef.current = gameState.currentRole;
  }, [gameState.currentRole]);

  useEffect(() => {
    if (canvasRef.current && !gameSceneRef.current) {
      gameSceneRef.current = new GameScene(canvasRef.current);
      gameSceneRef.current.onStateChange = (newState: any) => {
        setGameState(prev => ({ ...prev, ...newState }));
      };
    }

    return () => {
      if (gameSceneRef.current) {
        gameSceneRef.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (gameSceneRef.current) {
      gameSceneRef.current.setInput(input);
    }
  }, [input]);

  const handleJoinGame = () => {
    if (gameState.nickname.trim() && gameSceneRef.current) {
      gameSceneRef.current.joinGame(gameState.nickname.trim());
      setGameState(prev => ({ ...prev, showNicknameInput: false }));
    }
  };

  const transformByRole = (role: string, x: number, y: number): [number, number] => {
    console.log('TRANSFORM INPUT:', { role, x, y });
    // Rey and Rey1 work correctly with [x, -y]
    if (role === 'rey' || role === 'rey1') {
      const result: [number, number] = [x, -y];
      console.log('TRANSFORM OUTPUT (rey/rey1):', result);
      return result;
    }
    // Rey2 and Mato face opposite direction, need both axes inverted
    if (role === 'rey2' || role === 'mato') {
      const result: [number, number] = [-x, y];
      console.log('TRANSFORM OUTPUT (rey2/mato):', result);
      return result;
    }
    // Default
    return [x, -y];
  };  const applyMoveFromSources = () => {
    const j = joystickVecRef.current;
    const k = keyboardVecRef.current;
    const jMag = Math.hypot(j[0], j[1]);
    const kMag = Math.hypot(k[0], k[1]);

    // Decide precedence: if joystick active (>0.05), prefer it; else keyboard
    if (jMag > 0.05) {
      const [fx, fy] = transformByRole(currentRoleRef.current, j[0], j[1]);
      setInput(prev => ({ ...prev, move: [fx, fy] }));
      lastSourceRef.current = 'joystick';
    } else if (kMag > 0.05) {
      const [fx, fy] = transformByRole(currentRoleRef.current, k[0], k[1]);
      setInput(prev => ({ ...prev, move: [fx, fy] }));
      lastSourceRef.current = 'keyboard';
    } else {
      setInput(prev => ({ ...prev, move: [0, 0] }));
      lastSourceRef.current = null;
    }
  };

  const handleJoystickMove = (x: number, y: number) => {
    console.log('JOYSTICK RAW:', { x, y, role: currentRoleRef.current });
    joystickVecRef.current = [x, y];
    applyMoveFromSources();
  };

  const handleJump = () => {
    setInput(prev => ({ ...prev, jump: true }));
    setTimeout(() => {
      setInput(prev => ({ ...prev, jump: false }));
    }, 100);
  };

  const handleKick = () => {
    setInput(prev => ({ ...prev, action: 'kick' }));
    setTimeout(() => {
      setInput(prev => ({ ...prev, action: null }));
    }, 100);
  };

  const handleHead = () => {
    setInput(prev => ({ ...prev, action: 'head' }));
    setTimeout(() => {
      setInput(prev => ({ ...prev, action: null }));
    }, 100);
  };

  // Serve removed: ball auto-spawns from Rey quadrant with momentum

  // Keyboard: WASD and Arrow keys
  useEffect(() => {
    if (gameState.showNicknameInput) {
      // Don't bind gameplay keys while entering nickname
      return;
    }
    const down = new Set<string>();
    const handlerDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ([ 'w','a','s','d','arrowup','arrowleft','arrowdown','arrowright' ].includes(key)) {
        down.add(key);
        e.preventDefault();
        const x = (down.has('a') || down.has('arrowleft') ? -1 : 0) + (down.has('d') || down.has('arrowright') ? 1 : 0);
        const y = (down.has('w') || down.has('arrowup') ? 1 : 0) + (down.has('s') || down.has('arrowdown') ? -1 : 0);
        let nx = x; let ny = y;
        const mag = Math.hypot(nx, ny);
        if (mag > 0) { nx /= mag; ny /= mag; }
        keyboardVecRef.current = [nx, ny];
        // Only override joystick if joystick is idle
        if (lastSourceRef.current !== 'joystick') {
          applyMoveFromSources();
        }
      }
      // Space for jump
      if (e.code === 'Space') {
        handleJump();
      }
    };
    const handlerUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ([ 'w','a','s','d','arrowup','arrowleft','arrowdown','arrowright' ].includes(key)) {
        down.delete(key);
        const x = (down.has('a') || down.has('arrowleft') ? -1 : 0) + (down.has('d') || down.has('arrowright') ? 1 : 0);
        const y = (down.has('w') || down.has('arrowup') ? 1 : 0) + (down.has('s') || down.has('arrowdown') ? -1 : 0);
        let nx = x; let ny = y;
        const mag = Math.hypot(nx, ny);
        if (mag > 0) { nx /= mag; ny /= mag; } else { nx = 0; ny = 0; }
        keyboardVecRef.current = [nx, ny];
        if (lastSourceRef.current !== 'joystick') {
          applyMoveFromSources();
        }
      }
    };
    globalThis.addEventListener('keydown', handlerDown as any, { passive: false } as any);
    globalThis.addEventListener('keyup', handlerUp as any, { passive: false } as any);
    return () => {
      globalThis.removeEventListener('keydown', handlerDown as any);
      globalThis.removeEventListener('keyup', handlerUp as any);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentRole, gameState.showNicknameInput]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'rey': return 'REY 👑';
      case 'rey1': return 'REY 1';
      case 'rey2': return 'REY 2';
      case 'mato': return 'MATO';
      case 'queue': return 'WAITING...';
      default: return role.toUpperCase();
    }
  };

  return (
    <div className="app">
      <canvas ref={canvasRef} className="game-canvas" />
      
      {/* Nickname Input Modal */}
      {gameState.showNicknameInput && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Rey Mato</h2>
            <p>Enter your nickname to join the game:</p>
            <input
              type="text"
              value={gameState.nickname}
              onChange={(e) => setGameState(prev => ({ ...prev, nickname: e.target.value }))}
              placeholder="Your nickname"
              maxLength={15}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()}
            />
            <button onClick={handleJoinGame} disabled={!gameState.nickname.trim()}>
              Join Game
            </button>
          </div>
        </div>
      )}

      {/* Game HUD */}
      {!gameState.showNicknameInput && (
        <>
          <div className="hud">
            <div className="hud-top">
              <div className="role-display">
                {getRoleDisplayName(gameState.currentRole)}
              </div>
              <div className="time-display">
                Match: {formatTime(gameState.matchTime)}
              </div>
            </div>
            
            {gameState.currentRole === 'rey' && (
              <div className="rey-time">
                Rey Time: {formatTime(gameState.timeAsRey)}
              </div>
            )}

            {/* Serve indicator removed; serves are now automatic */}

            <div className="connection-status">
              {gameState.connected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
          </div>

          {/* Mobile Controls */}
          <div className="controls">
            <div className="left-controls">
              <RcJoystickWrapper onMove={handleJoystickMove} />
            </div>
            
            <div className="right-controls">
              <button className="action-button jump-button" onMouseDown={handleJump} onTouchStart={handleJump}>
                JUMP
              </button>
              
              {/* Serve button removed */}
              
              <div className="action-row">
                <button className="action-button kick-button" onMouseDown={handleKick} onTouchStart={handleKick}>
                  KICK
                </button>
                <button className="action-button head-button" onMouseDown={handleHead} onTouchStart={handleHead}>
                  HEAD
                </button>
              </div>
            </div>
          </div>

          {/* Leaderboard Modal */}
          {gameState.showLeaderboard && (
            <div className="modal-overlay">
              <div className="modal leaderboard-modal">
                <h2>🏆 Final Leaderboard</h2>
                <div className="leaderboard">
                  {gameState.leaderboard.map((entry, index) => (
                    <div key={`${entry.nickname}-${index}`} className={`leaderboard-entry ${index === 0 ? 'winner' : ''}`}>
                      <span className="rank">#{index + 1}</span>
                      <span className="name">{entry.nickname}</span>
                      <span className="time">{formatTime(entry.timeAsRey)}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setGameState(prev => ({ ...prev, showLeaderboard: false }))}>
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;