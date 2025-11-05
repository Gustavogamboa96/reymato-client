import * as THREE from 'three';
import * as Colyseus from 'colyseus.js';

interface PlayerState {
  id: string;
  nickname: string;
  role: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  active: boolean;
  timeAsRey: number;
  jumping: boolean;
  vx: number;
  vz: number;
}

interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  lastTouchedBy: string;
  lastBounceOnRole: string;
  lastBounceTime: number;
  bounceCount: number;
}

interface GameStateSchema {
  players: Map<string, PlayerState>;
  ball: BallState;
  currentServer: string;
  queue: string[];
  elapsed: number;
  matchDuration: number;
  matchStarted: boolean;
  matchEnded: boolean;
  waitingForServe: boolean;
}

interface InputState {
  move: [number, number];
  jump: boolean;
  action: 'kick' | 'head' | 'serve' | null;
}

export default class GameScene {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private client!: Colyseus.Client;
  private room: Colyseus.Room<GameStateSchema> | null = null;
  
  // Game objects
  private readonly playerMeshes: Map<string, THREE.Group> = new Map();
  private ballMesh: THREE.Mesh | null = null;
  private courtMesh: THREE.Group | null = null;
  
  // Player state
  private myPlayerId: string = '';
  private currentInput: InputState = { move: [0, 0], jump: false, action: null };
  private lastInputSent = 0;
  private playerAnimations = new Map<string, { type: string, startTime: number }>();
  
  // Camera control - fixed position looking into court
  private readonly cameraDistance = 12; // Increased for larger court
  private readonly cameraHeight = 8;    // Higher for better court view
  
  public onStateChange: ((state: any) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // Initialize Three.js
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ 
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false; // Disable shadows to prevent trails
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    this.setupScene();
    this.setupNetworking();
    this.setupEventListeners();
    this.startRenderLoop();
  }

  private setupScene() {
    // Background
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = false; // Disable shadow casting
    this.scene.add(directionalLight);

    // Create court
    this.createCourt();
    
    // Create ball
    this.createBall();

    // Set initial camera position
    this.camera.position.set(0, this.cameraHeight, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);
  }

  private createCourt() {
    this.courtMesh = new THREE.Group();

    // Court dimensions - match server size
    const courtSize = 16;
    const halfSize = courtSize / 2;

    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(courtSize, courtSize);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90EE90 }); // Light green
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.courtMesh.add(ground);

    // Court lines
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineWidth = 0.1;
    const lineHeight = 0.01;

    // Center lines
    const centerLineH = new THREE.Mesh(
      new THREE.BoxGeometry(courtSize, lineHeight, lineWidth),
      lineMaterial
    );
    centerLineH.position.y = lineHeight / 2;
    this.courtMesh.add(centerLineH);

    const centerLineV = new THREE.Mesh(
      new THREE.BoxGeometry(lineWidth, lineHeight, courtSize),
      lineMaterial
    );
    centerLineV.position.y = lineHeight / 2;
    this.courtMesh.add(centerLineV);

    // Border lines
    const borders = [
      { pos: [0, lineHeight / 2, halfSize], size: [courtSize, lineHeight, lineWidth] },
      { pos: [0, lineHeight / 2, -halfSize], size: [courtSize, lineHeight, lineWidth] },
      { pos: [halfSize, lineHeight / 2, 0], size: [lineWidth, lineHeight, courtSize] },
      { pos: [-halfSize, lineHeight / 2, 0], size: [lineWidth, lineHeight, courtSize] }
    ];

    for (const border of borders) {
      const borderMesh = new THREE.Mesh(
        new THREE.BoxGeometry(border.size[0], border.size[1], border.size[2]),
        lineMaterial
      );
      borderMesh.position.set(border.pos[0], border.pos[1], border.pos[2]);
      this.courtMesh!.add(borderMesh);
    }

    // Quadrant colors (subtle tinting)
    const quadrantColors = [
      { color: 0xFFD700, pos: [halfSize / 2, 0.005, halfSize / 2] }, // Rey - Gold
      { color: 0xC0C0C0, pos: [-halfSize / 2, 0.005, halfSize / 2] }, // Rey1 - Silver
      { color: 0xCD7F32, pos: [-halfSize / 2, 0.005, -halfSize / 2] }, // Rey2 - Bronze
      { color: 0xFF6B6B, pos: [halfSize / 2, 0.005, -halfSize / 2] }  // Mato - Red
    ];

    for (const quad of quadrantColors) {
      const quadGeometry = new THREE.PlaneGeometry(halfSize - 0.1, halfSize - 0.1);
      const quadMaterial = new THREE.MeshLambertMaterial({ 
        color: quad.color, 
        transparent: true, 
        opacity: 0.3 
      });
      const quadMesh = new THREE.Mesh(quadGeometry, quadMaterial);
      quadMesh.rotation.x = -Math.PI / 2;
      quadMesh.position.set(quad.pos[0], quad.pos[1], quad.pos[2]);
      this.courtMesh!.add(quadMesh);
    }

    // Add position labels with emojis
    const quadrantLabels = [
      { text: '👑 REY', pos: [halfSize / 2, 0.02, halfSize / 2], color: '#FFD700' }, // Rey - Gold
      { text: '🥈 REY1', pos: [-halfSize / 2, 0.02, halfSize / 2], color: '#C0C0C0' }, // Rey1 - Silver
      { text: '🥉 REY2', pos: [-halfSize / 2, 0.02, -halfSize / 2], color: '#CD7F32' }, // Rey2 - Bronze
      { text: '💩 MATO', pos: [halfSize / 2, 0.02, -halfSize / 2], color: '#FF6B6B' }  // Mato - Red with poop emoji
    ];

    for (const label of quadrantLabels) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = 256;
      canvas.height = 128;
      
      // Clear canvas
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw text
      context.fillStyle = label.color;
      context.font = 'bold 32px Arial';
      context.textAlign = 'center';
      context.fillText(label.text, canvas.width / 2, canvas.height / 2 + 10);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true,
        alphaTest: 0.1
      });
      
      const geometry = new THREE.PlaneGeometry(2, 1);
      const textMesh = new THREE.Mesh(geometry, material);
      textMesh.rotation.x = -Math.PI / 2;
      textMesh.position.set(label.pos[0], label.pos[1], label.pos[2]);
      this.courtMesh!.add(textMesh);
    }

    this.scene.add(this.courtMesh);
  }

  private createAmongUsCharacter(role: string): THREE.Group {
    const character = new THREE.Group();
    const roleColor = this.getRoleColor(role);
    
    // Main body (pill-shaped - cylinder with rounded ends)
    const bodyGeometry = new THREE.CapsuleGeometry(0.6, 1.2, 4, 8);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: roleColor });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.8;
    body.castShadow = true;
    character.add(body);
    
    // Visor (glass window) - dark blue/black ellipse
    const visorGeometry = new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const visorMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.8
    });
    const visor = new THREE.Mesh(visorGeometry, visorMaterial);
    visor.position.set(0.3, 1.1, 0);
    visor.rotation.z = -Math.PI / 2;
    character.add(visor);
    
    // Backpack (small rounded rectangle)
    const backpackGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.15);
    const backpackMaterial = new THREE.MeshLambertMaterial({ 
      color: new THREE.Color(roleColor).multiplyScalar(0.8) // Darker shade
    });
    const backpack = new THREE.Mesh(backpackGeometry, backpackMaterial);
    backpack.position.set(-0.45, 0.8, 0);
    backpack.castShadow = true;
    character.add(backpack);
    
    // Legs (short stubs)
    const legGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8);
    const legMaterial = new THREE.MeshLambertMaterial({ color: roleColor });
    
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.2, 0.1, 0);
    leftLeg.castShadow = true;
    leftLeg.name = 'leftLeg'; // For animation
    character.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.2, 0.1, 0);
    rightLeg.castShadow = true;
    rightLeg.name = 'rightLeg'; // For animation
    character.add(rightLeg);
    
    // Feet (oval shapes)
    const footGeometry = new THREE.SphereGeometry(0.2, 8, 6);
    footGeometry.scale(1.5, 0.5, 1); // Make it oval/flat
    const footMaterial = new THREE.MeshLambertMaterial({ color: roleColor });
    
    const leftFoot = new THREE.Mesh(footGeometry, footMaterial);
    leftFoot.position.set(-0.2, -0.1, 0.1);
    leftFoot.castShadow = true;
    leftFoot.name = 'leftFoot'; // For animation
    character.add(leftFoot);
    
    const rightFoot = new THREE.Mesh(footGeometry, footMaterial);
    rightFoot.position.set(0.2, -0.1, 0.1);
    rightFoot.castShadow = true;
    rightFoot.name = 'rightFoot'; // For animation
    character.add(rightFoot);
    
    return character;
  }

  private createBall() {
    // Even bigger bouncy ball
    const ballGeometry = new THREE.SphereGeometry(0.9, 16, 16); // Match server size (0.9)
    const ballMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xFFFFFF,
      transparent: true,
      opacity: 0.95
    });
    this.ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
    this.ballMesh.castShadow = false; // No shadows
    this.ballMesh.position.set(0, 2, 0); // Start higher
    this.scene.add(this.ballMesh);
  }

  private createPlayerMesh(_playerId: string, nickname: string, role: string): THREE.Group {
    const playerGroup = new THREE.Group();

    // Create custom Among Us-style character
    const amongUsCharacter = this.createAmongUsCharacter(role);
    playerGroup.add(amongUsCharacter);

    // Name label with role emoji
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 80;
    
    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Role emoji and name
    const roleEmojis = {
      'rey': '👑',
      'rey1': '🥈',
      'rey2': '🥉',
      'mato': '💩'
    };
    
    const emoji = roleEmojis[role as keyof typeof roleEmojis] || '🔵';
    const roleColor = this.getRoleColor(role);
    
    // Draw emoji
    context.font = '20px Arial';
    context.textAlign = 'center';
    context.fillText(emoji, canvas.width / 2, 25);
    
    // Draw role name
    context.fillStyle = `#${roleColor.toString(16).padStart(6, '0')}`;
    context.font = 'bold 16px Arial';
    context.fillText(role.toUpperCase(), canvas.width / 2, 45);
    
    // Draw nickname
    context.fillStyle = '#FFFFFF';
    context.font = '14px Arial';
    context.fillText(nickname, canvas.width / 2, 65);

    const labelTexture = new THREE.CanvasTexture(canvas);
    const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
    const labelSprite = new THREE.Sprite(labelMaterial);
    labelSprite.position.y = 3;
    labelSprite.scale.set(2, 0.5, 1);
    playerGroup.add(labelSprite);

    return playerGroup;
  }

  private getRoleColor(role: string): number {
    switch (role) {
      case 'rey': return 0xFFD700; // Gold
      case 'rey1': return 0xC0C0C0; // Silver
      case 'rey2': return 0xCD7F32; // Bronze
      case 'mato': return 0xFF6B6B; // Red
      default: return 0x808080; // Gray
    }
  }

  private setupNetworking() {
    // Simple setup: localhost for development, Render for production
    let wsUrl: string;
    
    console.log('Environment check:');
    console.log('hostname:', globalThis.location.hostname);
    console.log('protocol:', globalThis.location.protocol);
    
    // If running on localhost, connect to local server
    if (globalThis.location.hostname === 'localhost') {
      wsUrl = 'ws://localhost:2567';  // Local server port
      console.log('✅ Using local development server');
    } else {
      // Production environment - use Render server
      wsUrl = 'wss://reymato-server.onrender.com';
      console.log('✅ Using production Render server');
    }
    
    console.log('Final WebSocket URL:', wsUrl);
    console.log('Connecting to WebSocket:', wsUrl);
    
    // Test the server health first if it's the Render server
    if (wsUrl.includes('reymato-server.onrender.com')) {
      console.log('🏥 Testing server health first...');
      fetch('https://reymato-server.onrender.com/health')
        .then(response => response.json())
        .then(data => {
          console.log('✅ Server health check passed:', data);
        })
        .catch(error => {
          console.error('❌ Server health check failed:', error);
        });
    }
    
    this.client = new Colyseus.Client(wsUrl);
  }

  private setupEventListeners() {
    // Window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Input sending interval
    setInterval(() => {
      this.sendInput();
    }, 1000 / 20); // 20 times per second
  }

  private startRenderLoop() {
    const animate = () => {
      requestAnimationFrame(animate);
      this.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private update() {
    // Fixed camera positioning based on quadrant orientation
    const myPlayer = this.room?.state.players.get(this.myPlayerId);
    
    if (myPlayer) {
      // Use only ground position for camera tracking (ignore Y to prevent shake)
      const playerGroundPos = new THREE.Vector3(myPlayer.x, 0, myPlayer.z);
      
      // Fixed forward direction - square arrangement, straight across
      let forwardX = 0, forwardZ = 0;
      
      switch (myPlayer.role) {
        case 'rey':
          // Rey (top-right) faces straight down toward Mato (bottom-right)
          forwardX = 0; forwardZ = -1;
          break;
        case 'rey1':
          // Rey1 (top-left) faces straight down toward Rey2 (bottom-left)
          forwardX = 0; forwardZ = -1;
          break;
        case 'rey2':
          // Rey2 (bottom-left) faces straight up toward Rey1 (top-left)
          forwardX = 0; forwardZ = 1;
          break;
        case 'mato':
          // Mato (bottom-right) faces straight up toward Rey (top-right)
          forwardX = 0; forwardZ = 1;
          break;
      }
      
      // Normalize forward direction
      const forwardLength = Math.hypot(forwardX, forwardZ);
      if (forwardLength > 0) {
        forwardX /= forwardLength;
        forwardZ /= forwardLength;
      }
      
      // Position camera behind the player at FIXED HEIGHT (no Y following)
      const cameraOffset = new THREE.Vector3(
        -forwardX * this.cameraDistance,
        this.cameraHeight, // Fixed camera height
        -forwardZ * this.cameraDistance
      );
      
      const desiredCameraPos = playerGroundPos.clone().add(cameraOffset);
      
      // Look at court center at ground level for stable view
      const lookAtPos = new THREE.Vector3(0, 1, 0); // Fixed look at court center
      
      // Very smooth camera movement to prevent any jitter
      this.camera.position.lerp(desiredCameraPos, 0.05); // Slower lerp for stability
      this.camera.lookAt(lookAtPos);
      
      // Debug: Log player position occasionally
      if (Math.random() < 0.01) { // Log 1% of the time to avoid spam
        console.log(`Player ${this.myPlayerId} at position:`, myPlayer.x, myPlayer.y, myPlayer.z, 'Role:', myPlayer.role);
      }
    } else {
      // Default camera position if no player found
      const defaultPos = new THREE.Vector3(0, this.cameraHeight, this.cameraDistance);
      const defaultLookAt = new THREE.Vector3(0, 0, 0);
      this.camera.position.lerp(defaultPos, 0.05);
      this.camera.lookAt(defaultLookAt);
    }

    // Update player animations
    this.updatePlayerAnimations();

    // Update player jumping animations (simple up-down for jumping)
    for (const [playerId, mesh] of this.playerMeshes) {
      const player = this.room?.state.players.get(playerId);
      if (player?.jumping) {
        mesh.position.y = Math.sin(Date.now() * 0.01) * 0.1 + player.y;
      } else if (player) {
        mesh.position.y = player.y;
      }
    }
  }

  public async joinGame(nickname: string) {
    try {
      console.log('Attempting to join game with nickname:', nickname);
      console.log('Client setup with URL:', this.client ? 'Client exists' : 'No client!');
      
      this.room = await this.client.joinOrCreate<GameStateSchema>('rey_mato', { nickname });
      this.myPlayerId = this.room.sessionId;
      
      console.log('✅ Successfully joined game!');
      console.log('- Player ID:', this.myPlayerId);
      console.log('- Room ID:', this.room.id);
      console.log('- Initial state:', this.room.state);

      // Handle state changes
      this.room.onStateChange((state) => {
        console.log('🔄 State change received:', {
          players: state.players.size,
          ballPosition: state.ball ? `(${state.ball.x}, ${state.ball.y}, ${state.ball.z})` : 'No ball',
          matchStarted: state.matchStarted
        });
        this.updateGameObjects(state);
        this.updateUI(state);
      });

      // Handle messages
      this.room.onMessage('event', (message) => {
        console.log('📨 Game event received:', message);
        this.handleGameEvent(message);
      });
      
      // Handle player animations
      this.room.onMessage('playerAnimation', (message: { playerId: string; action: string }) => {
        console.log('🎭 Animation message:', message);
        this.animatePlayerKick(message.playerId, message.action);
      });

      // Handle room events - these are actually available on the room instance after joining
      console.log('✅ Room setup complete - waiting for state updates');
      if (this.onStateChange) {
        this.onStateChange({ connected: true });
      }

    } catch (error) {
      console.error('❌ Failed to join room:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      if (this.onStateChange) {
        this.onStateChange({ connected: false, error: error instanceof Error ? error.message : 'Connection failed' });
      }
    }
  }

  private updateGameObjects(state: GameStateSchema) {
    console.log('🎮 Updating game objects - Players:', state.players.size, 'Ball:', state.ball ? 'exists' : 'missing');
    
    // Update players
    for (const [playerId, player] of state.players) {
      if (!this.playerMeshes.has(playerId)) {
        // Create new player mesh
        console.log('🆕 Creating new player mesh for:', playerId, player.nickname, player.role);
        const playerMesh = this.createPlayerMesh(playerId, player.nickname, player.role);
        this.playerMeshes.set(playerId, playerMesh);
        this.scene.add(playerMesh);
        
        // If this is my player, immediately set camera to follow them
        if (playerId === this.myPlayerId) {
          console.log('📷 Setting up camera for my player:', playerId, 'at position:', player.x, player.y, player.z);
        }
      }

      const playerMesh = this.playerMeshes.get(playerId)!;
      
      // Direct position update (no lerping to avoid trails)
      const targetPos = new THREE.Vector3(player.x, player.y, player.z);
      playerMesh.position.copy(targetPos);
      
      playerMesh.rotation.y = player.rotY;

      // Update role color and check for role changes
      const newColor = this.getRoleColor(player.role);
      let hasColorChanged = false;
      
      // Update color for Among Us character (skip visor which should stay dark)
      playerMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material && child.material instanceof THREE.MeshLambertMaterial) {
          // Skip the visor (dark colored part)
          if (child.material.color.getHex() === 0x1a1a2e) return;
          
          const currentColor = child.material.color.getHex();
          if (currentColor !== newColor && currentColor !== 0x1a1a2e) {
            // Update main body and leg colors, keep backpack darker
            if (child.material.color.r > 0.5) { // Main body parts
              hasColorChanged = true;
              child.material.color.setHex(newColor);
            } else { // Backpack (darker version)
              hasColorChanged = true;
              child.material.color.setHex(new THREE.Color(newColor).multiplyScalar(0.8).getHex());
            }
          }
        }
      });
      
      if (hasColorChanged) {
        // Role changed! Add visual effect
        const glowGeometry = new THREE.SphereGeometry(1, 16, 16); // Slightly bigger glow
        const glowMaterial = new THREE.MeshBasicMaterial({ 
          color: newColor, 
          transparent: true, 
          opacity: 0.5 
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        glowMesh.position.copy(playerMesh.position);
        glowMesh.position.y += 1;
        this.scene.add(glowMesh);
        
        // Animate glow effect
        let glowOpacity = 0.8;
        let glowScale = 0.5;
        const glowAnimation = () => {
          glowOpacity -= 0.02;
          glowScale += 0.02;
          glowMaterial.opacity = glowOpacity;
          glowMesh.scale.setScalar(glowScale);
          
          if (glowOpacity > 0) {
            requestAnimationFrame(glowAnimation);
          } else {
            this.scene.remove(glowMesh);
            glowGeometry.dispose();
            glowMaterial.dispose();
          }
        };
        glowAnimation();
      }
    }

    // Remove disconnected players
    for (const [playerId, mesh] of this.playerMeshes) {
      if (!state.players.has(playerId)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(playerId);
      }
    }

    // Update ball
    if (this.ballMesh) {
      this.ballMesh.position.set(state.ball.x, state.ball.y, state.ball.z);
    }
  }

  private updateUI(state: GameStateSchema) {
    const myPlayer = state.players.get(this.myPlayerId);
    if (myPlayer && this.onStateChange) {
      this.onStateChange({
        currentRole: myPlayer.role,
        timeAsRey: myPlayer.timeAsRey,
        matchTime: state.elapsed,
        connected: true,
        waitingForServe: state.waitingForServe,
        currentServer: state.currentServer
      });
    }
  }

  private handleGameEvent(message: any) {
    console.log('Game event:', message);
    
    if (message.type === 'matchEnd' && this.onStateChange) {
      this.onStateChange({
        showLeaderboard: true,
        leaderboard: message.leaderboard
      });
    }
  }

  public setInput(input: InputState) {
    // Trigger animation when action is performed
    if (input.action && this.currentInput.action !== input.action) {
      this.animatePlayerKick(this.myPlayerId, input.action);
    }
    
    this.currentInput = { ...input };
  }

  private sendInput() {
    if (!this.room) return;

    const now = Date.now();
    if (now - this.lastInputSent < 50) return; // Throttle to 20fps

    this.room.send('input', {
      type: 'input',
      move: this.currentInput.move,
      jump: this.currentInput.jump,
      action: this.currentInput.action
    });

    this.lastInputSent = now;
  }

  private animatePlayerKick(playerId: string, action: string = 'kick') {
    // Start kick or head animation
    this.playerAnimations.set(playerId, {
      type: action,
      startTime: Date.now()
    });
  }

  private updatePlayerAnimations() {
    const now = Date.now();
    
    for (const [playerId, animation] of this.playerAnimations) {
      const elapsed = now - animation.startTime;
      const playerMesh = this.playerMeshes.get(playerId);
      
      if (!playerMesh) continue;
      
      if ((animation.type === 'kick' || animation.type === 'head') && elapsed < 500) { // 500ms animation
        const progress = elapsed / 500; // 0 to 1
        
        if (animation.type === 'kick') {
          // Find the legs and feet for kick animation
          const rightLeg = playerMesh.getObjectByName('rightLeg');
          const rightFoot = playerMesh.getObjectByName('rightFoot');
          const leftLeg = playerMesh.getObjectByName('leftLeg');
          const leftFoot = playerMesh.getObjectByName('leftFoot');
          
          if (rightLeg && rightFoot && leftLeg && leftFoot) {
            // More dramatic kick animation
            const kickProgress = Math.sin(progress * Math.PI); // 0 to 1 and back to 0
            
            // Right leg kicks forward
            const kickAngle = kickProgress * 1.2; // More pronounced kick
            rightLeg.rotation.x = kickAngle;
            rightFoot.position.z = 0.1 + kickProgress * 0.6; // Foot moves forward more
            rightFoot.rotation.x = kickProgress * 0.5; // Foot tilts up during kick
            
            // Left leg supports (slight backward lean)
            leftLeg.rotation.x = -kickProgress * 0.3;
            leftFoot.position.z = 0.1 - kickProgress * 0.2; // Support foot moves back slightly
            
            // Slight body lean forward during kick
            const character = playerMesh.getObjectByName('character');
            if (character) {
              character.rotation.x = kickProgress * 0.2;
            }
          }
        } else if (animation.type === 'head') {
          // Head animation - tilt the whole character forward slightly
          const character = playerMesh.getObjectByName('character');
          if (character) {
            const headTilt = Math.sin(progress * Math.PI) * 0.3;
            character.rotation.x = headTilt;
          }
        }
      } else {
        // Animation finished, reset to neutral position
        const rightLeg = playerMesh.getObjectByName('rightLeg');
        const rightFoot = playerMesh.getObjectByName('rightFoot');
        const leftLeg = playerMesh.getObjectByName('leftLeg');
        const leftFoot = playerMesh.getObjectByName('leftFoot');
        const character = playerMesh.getObjectByName('character');
        
        // Reset all leg and foot positions
        if (rightLeg && rightFoot) {
          rightLeg.rotation.x = 0;
          rightFoot.position.z = 0.1;
          rightFoot.rotation.x = 0;
        }
        
        if (leftLeg && leftFoot) {
          leftLeg.rotation.x = 0;
          leftFoot.position.z = 0.1;
        }
        
        if (character) {
          character.rotation.x = 0;
        }
        
        this.playerAnimations.delete(playerId);
      }
    }
  }

  public getMyPlayer() {
    return this.room?.state.players.get(this.myPlayerId);
  }

  public dispose() {
    if (this.room) {
      this.room.leave();
    }
    
    // Dispose Three.js resources
    for (const mesh of this.playerMeshes.values()) {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
        }
      });
    }

    if (this.ballMesh) {
      this.ballMesh.geometry.dispose();
      (this.ballMesh.material as THREE.Material).dispose();
    }

    if (this.courtMesh) {
      this.courtMesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();
  }
}