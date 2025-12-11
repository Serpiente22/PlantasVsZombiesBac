// src/game/game.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { GameService } from './game.service';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Mapa para guardar los temporizadores de cada sala
  private turnTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly roomsService: RoomsService,
    private readonly gameService: GameService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`Jugador conectado: ${client.id}`);
    client.emit('connected', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log(`Jugador desconectado: ${client.id}`);
    const room = this.roomsService.findRoomByPlayer(client.id);

    // Solo eliminamos si NO es un bot
    if (!client.id.startsWith('BOT-')) {
        // NOTA: Para permitir reconexión (F5), NO eliminamos al jugador del juego inmediatamente.
        // Solo lo marcamos desconectado o no hacemos nada aquí si queremos persistencia real.
        // Si lo borras aquí, el F5 fallará.
        
        // OPCIÓN RECOMENDADA PARA PERSISTENCIA:
        // No borrar del GameService aquí. Solo borrar si la sala está en 'waiting'.
        // Si está en 'playing', dejarlo "afk".
        
        const game = room ? this.gameService.getGame(room.id) : null;
        if (!game || game.status === 'waiting') {
             this.gameService.removePlayer(client.id);
             this.roomsService.removePlayerFromRoom(client.id);
        }
    }

    if (room) {
      this.server.to(room.id).emit('roomUpdated', room);
      // No emitimos game_state aquí para no causar renderizados raros si solo fue un parpadeo
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.createRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });
    client.join(data.roomId);
    this.gameService.createGame(data.roomId);
    this.server.to(data.roomId).emit('roomCreated', room);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);
    const joinedRoom = this.roomsService.joinRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });

    const isAlreadyIn = room?.players.find((p) => p.id === client.id);

    if (!joinedRoom && !isAlreadyIn) {
      client.emit('errorJoining', 'Error al unirse.');
      return;
    }

    const activeRoom = joinedRoom || room;
    if (!activeRoom) {
       client.emit('errorJoining', 'Sala no encontrada');
       return; 
    }

    client.join(data.roomId);
    this.server.to(data.roomId).emit('roomJoined', activeRoom);

    // Sincronizar juego si existe
    const game = this.gameService.getGame(data.roomId);
    if (game) {
      const p = activeRoom.players.find((pl) => pl.id === client.id);
      if (p) {
        this.gameService.addPlayerToGame(data.roomId, {
          id: p.id,
          name: p.name,
          color: p.color,
        });
      }
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) this.server.to(data.roomId).emit('game_state', state);
    }

    if (activeRoom.players.length >= 2 && activeRoom.status !== 'playing') {
      activeRoom.status = 'ready';
      this.server.to(data.roomId).emit('roomUpdated', activeRoom);
    }
  }

  @SubscribeMessage('addBot')
  handleAddBot(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
      const room = this.roomsService.addBotToRoom(data.roomId);
      if (room) {
          this.server.to(data.roomId).emit('roomUpdated', room);
          this.server.to(data.roomId).emit('message', '🤖 Bot añadido a la sala');
      } else {
          client.emit('error', 'No se pudo añadir bot.');
      }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);
    if (!room) return;

    let game = this.gameService.getGame(data.roomId);
    if (!game) game = this.gameService.createGame(data.roomId);

    room.players.forEach(p => {
        this.gameService.addPlayerToGame(data.roomId, {
            id: p.id, 
            name: p.name, 
            color: p.color 
        });
    });

    room.status = 'playing';
    this.server.to(data.roomId).emit('roomUpdated', room);

    this.gameService.startGame(this.server, data.roomId);

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('gameInitialized', { roomId: data.roomId });
      this.server.to(data.roomId).emit('game_state', state);
      
      this.startTurnTimer(data.roomId); // Iniciar timer del primer turno
      this.processBotTurn(data.roomId);
    }
  }

  @SubscribeMessage('rollDice')
  handleRollDice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') return;

    const current = game.players[game.turnIndex];
    if (current?.id !== client.id) { client.emit('error', 'No es tu turno.'); return; }
    if (game.dice !== null) { client.emit('error', 'Ya tiraste.'); return; }

    // Detener timer porque ya actuó (tiró dado) -> Reiniciamos timer para mover ficha
    this.resetTurnTimer(data.roomId); 

    const value = this.gameService.rollDice(data.roomId);
    this.server.to(data.roomId).emit('diceRolled', { value });

    if (!this.gameService.hasAnyValidMove(data.roomId)) {
      setTimeout(() => {
        this.advanceAndNotify(data.roomId, current.name, 'no tiene movimientos');
      }, 1500);
    } else {
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) this.server.to(data.roomId).emit('game_state', state);
      // Reiniciamos timer para darle tiempo de mover
      this.startTurnTimer(data.roomId); 
    }
  }

  @SubscribeMessage('movePiece')
  handleMovePiece(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerId: string; pieceIndex: number },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') return;

    const current = game.players[game.turnIndex];
    if (current.id !== client.id) return;

    const result = this.gameService.movePiece(data.roomId, current.id, data.pieceIndex);
    if (!result.success) { client.emit('error', 'Movimiento inválido'); return; }

    this.clearTurnTimer(data.roomId); // Detener timer, turno completado

    if (result.eatenPlayerName) {
        this.server.to(data.roomId).emit('killEvent', { killer: current.name, victim: result.eatenPlayerName });
    }

    this.gameService.advanceTurn(data.roomId);

    this.server.to(data.roomId).emit('pieceMoved', { ...data, playerId: current.id });
    
    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });

      this.startTurnTimer(data.roomId); // Timer para el siguiente
      this.processBotTurn(data.roomId);
    }
  }

  @SubscribeMessage('surrender')
  handleSurrender(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { roomId: string }
  ) {
      const success = this.gameService.surrender(data.roomId, client.id);
      if (success) {
          this.server.to(data.roomId).emit('message', `🏳️ ${client.id.substr(0,4)} se ha rendido.`);
          
          const state = this.gameService.getPublicGameState(data.roomId);
          if (state) {
              this.server.to(data.roomId).emit('game_state', state);
              // Si al rendirse pasó el turno, actualizar timer y bots
              this.resetTurnTimer(data.roomId);
              this.startTurnTimer(data.roomId);
              this.processBotTurn(data.roomId);
          }
      }
  }

  // --- GESTIÓN DE TIMERS (15s) ---
  private startTurnTimer(roomId: string) {
      this.clearTurnTimer(roomId);
      
      const game = this.gameService.getGame(roomId);
      if (!game || game.status !== 'in-progress') return;

      // Solo poner timer si es HUMANO (los bots tienen su propio timeout interno)
      const current = game.players[game.turnIndex];
      if (current.id.startsWith('BOT-')) return;

      const timer = setTimeout(() => {
          this.handleTurnTimeout(roomId);
      }, 15000); // 15 Segundos

      this.turnTimers.set(roomId, timer);
  }

  private clearTurnTimer(roomId: string) {
      const timer = this.turnTimers.get(roomId);
      if (timer) clearTimeout(timer);
      this.turnTimers.delete(roomId);
  }

  private resetTurnTimer(roomId: string) {
      this.clearTurnTimer(roomId);
      this.startTurnTimer(roomId);
  }

  private handleTurnTimeout(roomId: string) {
      const game = this.gameService.getGame(roomId);
      if (!game) return;

      const current = game.players[game.turnIndex];
      console.log(`⏰ Tiempo agotado para ${current.name}`);
      
      // Lógica de Auto-Jugada
      // 1. Si no ha tirado dado, tirar
      if (game.dice === null) {
          const value = this.gameService.rollDice(roomId);
          this.server.to(roomId).emit('diceRolled', { value });
          
          // Darle un par de segundos extra para ver el dado antes de mover solo
          setTimeout(() => {
              this.executeAutoMove(roomId);
          }, 1000);
      } else {
          // 2. Si ya tiró, mover ficha automáticamente
          this.executeAutoMove(roomId);
      }
  }

  private executeAutoMove(roomId: string) {
      const game = this.gameService.getGame(roomId);
      if (!game) return;
      const current = game.players[game.turnIndex];

      if (!this.gameService.hasAnyValidMove(roomId)) {
          this.advanceAndNotify(roomId, current.name, 'tiempo agotado y sin movimientos');
      } else {
          // Usar la IA del bot para elegir el mejor movimiento por el humano
          const pieceIndex = this.gameService.getAutomatedBotMove(roomId);
          if (pieceIndex !== -1) {
              const result = this.gameService.movePiece(roomId, current.id, pieceIndex);
              
              if (result.eatenPlayerName) {
                  this.server.to(roomId).emit('killEvent', { killer: current.name, victim: result.eatenPlayerName });
              }
              this.server.to(roomId).emit('pieceMoved', { roomId, playerId: current.id, pieceIndex });
              this.server.to(roomId).emit('message', `⚡ Jugada automática por ${current.name} (AFK)`);
              
              this.advanceAndNotify(roomId, '', ''); // Avanzar sin mensaje extra
          }
      }
  }

  private advanceAndNotify(roomId: string, playerName: string, reason: string) {
      this.gameService.advanceTurn(roomId);
      const newState = this.gameService.getPublicGameState(roomId);
      if (newState) {
          if (reason) this.server.to(roomId).emit('message', `${playerName}: ${reason}`);
          this.server.to(roomId).emit('game_state', newState);
          this.server.to(roomId).emit('turnChanged', { turnIndex: newState.turnIndex });
          
          this.startTurnTimer(roomId);
          this.processBotTurn(roomId);
      }
  }

  // --- BOT LOGIC (Igual que antes) ---
  private processBotTurn(roomId: string) {
      const game = this.gameService.getGame(roomId);
      if (!game || game.status !== 'in-progress') return;

      const currentPlayer = game.players[game.turnIndex];

      if (currentPlayer && currentPlayer.id.startsWith('BOT-')) {
          // ... (Lógica de bot igual, no hace falta repetirla si ya la tienes, pero asegúrate de que esté)
          setTimeout(() => {
              const currentGame = this.gameService.getGame(roomId);
              if (!currentGame || currentGame.players[currentGame.turnIndex].id !== currentPlayer.id) return;

              const value = this.gameService.rollDice(roomId);
              this.server.to(roomId).emit('diceRolled', { value });

              setTimeout(() => {
                  if (!this.gameService.hasAnyValidMove(roomId)) {
                      this.advanceAndNotify(roomId, currentPlayer.name, 'no puede mover');
                  } else {
                      const pieceIndex = this.gameService.getAutomatedBotMove(roomId);
                      if (pieceIndex !== -1) {
                          const result = this.gameService.movePiece(roomId, currentPlayer.id, pieceIndex);
                          if (result.eatenPlayerName) {
                              this.server.to(roomId).emit('killEvent', { killer: currentPlayer.name, victim: result.eatenPlayerName });
                          }
                          this.server.to(roomId).emit('pieceMoved', { roomId, playerId: currentPlayer.id, pieceIndex });
                          this.advanceAndNotify(roomId, '', '');
                      }
                  }
              }, 1500);
          }, 1000);
      }
  }
}