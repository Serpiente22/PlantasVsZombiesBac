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
  cors: {
    origin: '*',
  },
  transports: ['websocket'], // 🔹 Forzamos WebSocket
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly roomsService: RoomsService,
    private readonly gameService: GameService,
  ) {}

  handleConnection(client: Socket) {
    console.log('Jugador conectado:', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log('Jugador desconectado:', client.id);
    this.gameService.removePlayer(client.id);
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.createRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
      side: 'plant',
    });

    client.join(data.roomId);
    console.log(`Sala creada: ${data.roomId}`);
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
      side: 'zombie',
    });

    if (room) {
      client.join(data.roomId);
      console.log(`Jugador ${data.playerName} se unió a la sala ${data.roomId}`);
      this.server.to(data.roomId).emit('roomJoined', room);
    } else {
      client.emit('errorJoining', 'No se pudo unir a la sala.');
    }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    console.log(`Iniciando juego en la sala ${data.roomId}`);
    this.gameService.startGame(this.server, data.roomId);
  }

  @SubscribeMessage('placePlant')
  handlePlacePlant(@MessageBody() data: any) {
    console.log(`Planta colocada por ${data.playerId} en sala ${data.roomId}`);
    this.gameService.placePlant(
      this.server,
      data.roomId,
      data.playerId,
      data.plantData,
    );
  }

  @SubscribeMessage('placeZombie')
  handlePlaceZombie(@MessageBody() data: any) {
    console.log(`Zombie colocado por ${data.playerId} en sala ${data.roomId}`);
    this.gameService.placeZombie(
      this.server,
      data.roomId,
      data.playerId,
      data.zombieData,
    );
  }
}
