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
        this.gameService.removePlayer(client.id);
        this.roomsService.removePlayerFromRoom(client.id);
    }

    if (room) {
      this.server.to(room.id).emit('roomUpdated', room);
      const state = this.gameService.getPublicGameState(room.id);
      if (state) this.server.to(room.id).emit('game_state', state);
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

  // --- NUEVO: AÑADIR BOT ---
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
          client.emit('error', 'No se pudo añadir bot (sala llena o inexistente).');
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

    // Asegurar que TODOS los jugadores (incluyendo bots) estén en el juego
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
      
      // VERIFICAR SI EL PRIMER JUGADOR ES UN BOT
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

    const value = this.gameService.rollDice(data.roomId);
    this.server.to(data.roomId).emit('diceRolled', { value });

    if (!this.gameService.hasAnyValidMove(data.roomId)) {
      setTimeout(() => {
        this.gameService.advanceTurn(data.roomId);
        const newState = this.gameService.getPublicGameState(data.roomId);
        if (newState) {
          this.server.to(data.roomId).emit('message', `Jugador ${current.name} no tiene movimientos. Pasa turno.`);
          this.server.to(data.roomId).emit('game_state', newState);
          this.server.to(data.roomId).emit('turnChanged', { turnIndex: newState.turnIndex });
          
          // VERIFICAR SI EL SIGUIENTE ES BOT
          this.processBotTurn(data.roomId);
        }
      }, 1500);
    } else {
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) this.server.to(data.roomId).emit('game_state', state);
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
    if (current.id !== client.id) { client.emit('error', 'Turno inválido'); return; }

    const result = this.gameService.movePiece(data.roomId, current.id, data.pieceIndex);
    if (!result.success) { client.emit('error', 'Movimiento inválido'); return; }

    if (result.eatenPlayerName) {
        this.server.to(data.roomId).emit('killEvent', { killer: current.name, victim: result.eatenPlayerName });
    }

    // Regla: Si sacó 6, repite turno. Si no, avanza.
    // Para simplificar y cumplir requisitos previos, asumimos que siempre avanza
    // O si quieres implementar la regla del 6: 
    // const diceWas6 = (diceValue === 6); 
    // if (!diceWas6) this.gameService.advanceTurn(data.roomId);
    
    this.gameService.advanceTurn(data.roomId);

    this.server.to(data.roomId).emit('pieceMoved', { ...data, playerId: current.id });
    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });

      // VERIFICAR SI EL SIGUIENTE ES BOT
      this.processBotTurn(data.roomId);
    }
  }

  // --- LÓGICA DEL CEREBRO DEL BOT ---
  private processBotTurn(roomId: string) {
      const game = this.gameService.getGame(roomId);
      if (!game || game.status !== 'in-progress') return;

      const currentPlayer = game.players[game.turnIndex];

      // Verificar si es un BOT (ID empieza con "BOT-")
      if (currentPlayer && currentPlayer.id.startsWith('BOT-')) {
          console.log(`🤖 Turno del bot: ${currentPlayer.name}`);

          // 1. Simular tiempo de "pensar" antes de tirar el dado
          setTimeout(() => {
              // Verificar que el juego siga existiendo y sea su turno
              const currentGame = this.gameService.getGame(roomId);
              if (!currentGame || currentGame.players[currentGame.turnIndex].id !== currentPlayer.id) return;

              // Tirar dado
              const value = this.gameService.rollDice(roomId);
              this.server.to(roomId).emit('diceRolled', { value });

              // 2. Simular tiempo para "ver" el dado y mover
              setTimeout(() => {
                  if (!this.gameService.hasAnyValidMove(roomId)) {
                      // No puede mover
                      this.gameService.advanceTurn(roomId);
                      const newState = this.gameService.getPublicGameState(roomId);
                      if (newState) {
                          this.server.to(roomId).emit('message', `🤖 ${currentPlayer.name} no puede mover.`);
                          this.server.to(roomId).emit('game_state', newState);
                          this.server.to(roomId).emit('turnChanged', { turnIndex: newState.turnIndex });
                          // Recursión: revisar si el siguiente también es bot
                          this.processBotTurn(roomId);
                      }
                  } else {
                      // Calcular mejor movimiento
                      const pieceIndex = this.gameService.getAutomatedBotMove(roomId);
                      
                      if (pieceIndex !== -1) {
                          const result = this.gameService.movePiece(roomId, currentPlayer.id, pieceIndex);
                          
                          if (result.eatenPlayerName) {
                              this.server.to(roomId).emit('killEvent', { killer: currentPlayer.name, victim: result.eatenPlayerName });
                          }

                          this.server.to(roomId).emit('pieceMoved', { roomId, playerId: currentPlayer.id, pieceIndex });
                          
                          // Pasar turno
                          this.gameService.advanceTurn(roomId);

                          const newState = this.gameService.getPublicGameState(roomId);
                          if (newState) {
                              this.server.to(roomId).emit('game_state', newState);
                              this.server.to(roomId).emit('turnChanged', { turnIndex: newState.turnIndex });
                              // Recursión: revisar si el siguiente también es bot
                              this.processBotTurn(roomId);
                          }
                      }
                  }
              }, 1500); // 1.5s para mover después de tirar

          }, 1000); // 1s para tirar dado
      }
  }
}