import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}
