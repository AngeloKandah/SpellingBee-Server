import express from 'express';
import http from 'http';
import getWords from './wordGenerator.js';
import generateCode from './createRoomCode.js';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { MongoClient } from 'mongodb';

const DB = 'spellingbee';
const COLLECTION = 'servers';
const mongoClient = new MongoClient('mongodb://localhost:27017', {
  useUnifiedTopology: true,
});
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
  },
});
await mongoClient.connect();
try {
  await mongoClient.db(DB).createCollection(COLLECTION);
} catch (e) {
  // collection already exists
}
const mongoCollection = mongoClient.db(DB).collection(COLLECTION);
//io.adapter(createAdapter(mongoCollection));

io.on('connection', (socket) => {
  console.log('client connected: ', socket.id);

  socket.on('joiningRoom', ({ roomCode }) => {
    socket.join(roomCode);
    console.log(`${socket.id} joined ${roomCode}`);
    mongoCollection.findOneAndUpdate(
      { room: roomCode },
      { $push: { members: socket.id } }
    );
  });

  socket.on('createRoom', async () => {
    const roomCode = generateCode();
    socket.join(roomCode);
    io.to(roomCode).emit('roomCode', roomCode);
    const words = await getWords();
    mongoCollection.insertOne({
      room: roomCode,
      members: [socket.id],
      turn: 0,
      wordList: words,
    });
  });

  socket.on('checkAnswer', (arg, callback) => {
    console.log(arg);
    callback('received');
  });

  socket.on('disconnecting', (reason) => {
    const roomCode = [...socket.rooms][1];
    mongoCollection.findOneAndUpdate(
      { room: roomCode },
      { $pull: { members: socket.id } }
    );
    console.log(reason);
  });
});

/* setInterval(async () => {
  const words = await getWords();
  console.log(words);
  io.to('WVYBZE').emit('wordList', words);
}, 2000); */

server.listen(5000, () => {
  console.log('listening on port 5000');
});
