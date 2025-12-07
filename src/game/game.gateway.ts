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
    this.gameService.removePlayer(client.id);

    const room = this.roomsService.findRoomByPlayer(client.id);
    if (room) {
      this.server.to(room.id).emit('roomUpdated', room);
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
    const room = this.roomsService.joinRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });

    if (!room) {
      client.emit('errorJoining', 'No se pudo unir a la sala.');
      return;
    }

    client.join(data.roomId);

    const game = this.gameService.getGame(data.roomId);
    if (game) {
      const p = room.players.find((pl) => pl.id === client.id);
      if (p) {
        this.gameService.addPlayerToGame(data.roomId, {
          id: p.id,
          name: p.name,
          color: (p as any).color,
        });
      }
    }

    this.server.to(data.roomId).emit('roomJoined', room);

    if (room.players.length >= 2) {
      room.status = 'ready';
      this.server.to(data.roomId).emit('roomUpdated', room);
    }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);
    if (!room) {
      client.emit('error', 'Sala no encontrada');
      return;
    }

    let game = this.gameService.getGame(data.roomId);
    if (!game) {
      game = this.gameService.createGame(data.roomId);
      if (!game) {
        client.emit('error', 'No se pudo crear la partida');
        return;
      }
    }

    // limpiar y volver a agregar jugadores
    game.players = [];
    for (const pl of room.players) {
      this.gameService.addPlayerToGame(data.roomId, {
        id: pl.id,
        name: pl.name,
        color: (pl as any).color,
      });
    }

    this.gameService.startGame(this.server, data.roomId);

    this.server.to(data.roomId).emit('gameInitialized', { roomId: data.roomId });

    const state = this.gameService.getPublicGameState(data.roomId);
    this.server.to(data.roomId).emit('game_state', state);
  }

  @SubscribeMessage('rollDice')
  handleRollDice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const value = this.gameService.rollDice(data.roomId);
    if (value === null) {
      client.emit('error', 'No se puede tirar el dado');
      return;
    }

    this.server.to(data.roomId).emit('diceRolled', { value });

    const state = this.gameService.getPublicGameState(data.roomId);
    this.server.to(data.roomId).emit('game_state', state);
  }

  @SubscribeMessage('movePiece')
  handleMovePiece(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerId: string; pieceIndex: number },
  ) {
    const moved = this.gameService.movePiece(
      data.roomId,
      data.playerId,
      data.pieceIndex,
    );

    if (!moved) {
      client.emit('error', 'Movimiento inválido');
      return;
    }

    this.gameService.advanceTurn(data.roomId);

    this.server.to(data.roomId).emit('pieceMoved', data);

    const state = this.gameService.getPublicGameState(data.roomId);
    this.server.to(data.roomId).emit('game_state', state);

    this.server.to(data.roomId).emit('turnChanged', { turnIndex: state?.turnIndex });
  }
}
