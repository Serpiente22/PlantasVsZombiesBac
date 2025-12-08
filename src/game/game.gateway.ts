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

    this.gameService.removePlayer(client.id);
    this.roomsService.removePlayerFromRoom(client.id);

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
      client.emit('errorJoining', 'No se pudo unir a la sala (no existe o está llena).');
      return;
    }

    const activeRoom = joinedRoom || room;

    if (!activeRoom) {
      client.emit('errorJoining', 'Error inesperado: Sala no encontrada.');
      return;
    }

    client.join(data.roomId);
    this.server.to(data.roomId).emit('roomJoined', activeRoom);

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
      if (state) {
        this.server.to(data.roomId).emit('game_state', state);
      }
    }

    if (activeRoom.players.length >= 2 && activeRoom.status !== 'playing') {
      activeRoom.status = 'ready';
      this.server.to(data.roomId).emit('roomUpdated', activeRoom);
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

    room.status = 'playing';
    this.server.to(data.roomId).emit('roomUpdated', room);

    this.gameService.startGame(this.server, data.roomId);

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('gameInitialized', { roomId: data.roomId });
      this.server.to(data.roomId).emit('game_state', state);
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
    if (current?.id !== client.id) {
      client.emit('error', 'No es tu turno.');
      return;
    }

    if (game.dice !== null) {
      client.emit('error', 'Ya tiraste el dado. Mueve una ficha.');
      return;
    }

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
        }
      }, 1500);
    } else {
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) {
          this.server.to(data.roomId).emit('game_state', state);
      }
    }
  }

  @SubscribeMessage('movePiece')
  handleMovePiece(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; playerId: string; pieceIndex: number },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') return;

    const current = game.players[game.turnIndex];

    // --- SEGURIDAD DE TURNO ---
    // Verificar que el socket que envía el mensaje es el del turno actual
    if (current.id !== client.id) {
        // Ignoramos la petición si intenta mover fuera de turno o mover fichas de otro
        client.emit('error', '¡No es tu turno o intentas mover ficha ajena!');
        return;
    }

    // Usamos current.id para mover, ignorando el playerId que mande el frontend si fuera distinto
    const result = this.gameService.movePiece(
      data.roomId,
      current.id,
      data.pieceIndex,
    );

    if (!result.success) {
      client.emit('error', 'Movimiento inválido.');
      return;
    }

    // --- EMOCIÓN: KILL EVENT ---
    if (result.eatenPlayerName) {
        this.server.to(data.roomId).emit('killEvent', {
            killer: current.name,
            victim: result.eatenPlayerName
        });
    }

    // Avanzamos turno siempre tras mover (regla simple)
    this.gameService.advanceTurn(data.roomId);

    this.server.to(data.roomId).emit('pieceMoved', { ...data, playerId: current.id });

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });
    }
  }
}