import { useEffect, useRef, useState } from 'react';
import GameScene from './GameScene.ts';
import Joystick from './ui/Joystick.tsx';
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

  const handleJoystickMove = (x: number, y: number) => {
    // Apply role-based joystick orientation based on court position
    let finalX = x;  // Default X direction
    let finalY = -y; // Default: up moves away from camera (for Rey, Rey1)
    
    // Players on the bottom half of court (negative Z) need Y flipped
    if (gameState.currentRole === 'rey2' || gameState.currentRole === 'mato') {
      finalY = y; // For Rey2 and Mato: up moves toward camera (toward their back line)
    }
    
    // Players facing opposite directions need X flipped
    if (gameState.currentRole === 'rey2' || gameState.currentRole === 'mato') {
      finalX = -x; // For Rey2 and Mato: left/right are flipped
    }
    
    setInput(prev => ({ ...prev, move: [finalX, finalY] }));
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

  const handleServe = () => {
    setInput(prev => ({ ...prev, action: 'serve' }));
    setTimeout(() => {
      setInput(prev => ({ ...prev, action: null }));
    }, 100);
  };

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

            {gameState.waitingForServe && (
              <div className="serve-indicator">
                {gameState.currentServer === gameState.currentRole 
                  ? "🎾 Your serve! Tap SERVE button" 
                  : `⏳ Waiting for ${gameState.currentServer.toUpperCase()} to serve`}
              </div>
            )}

            <div className="connection-status">
              {gameState.connected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
          </div>

          {/* Mobile Controls */}
          <div className="controls">
            <div className="left-controls">
              <Joystick onMove={handleJoystickMove} />
            </div>
            
            <div className="right-controls">
              <button className="action-button jump-button" onMouseDown={handleJump} onTouchStart={handleJump}>
                JUMP
              </button>
              
              {/* Show serve button only when it's this player's turn to serve */}
              {gameState.waitingForServe && gameState.currentServer === gameState.currentRole && (
                <button className="action-button serve-button" onMouseDown={handleServe} onTouchStart={handleServe}>
                  SERVE
                </button>
              )}
              
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