import express from 'express';
import http from 'http';
import getWords from './wordGenerator.js';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
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

io.on('connection', (socket) => {
  socket.on('createRoom', async () => {
    const roomCode = nanoid();
    socket.join(roomCode);
    io.to(roomCode).emit('roomCode', roomCode);
    const words = await getWords();
    await mongoCollection.insertOne({
      room: roomCode,
      members: [socket.id],
      turn: 0,
      wordList: words,
    });
    socket.emit('word', words[0]);
  });

  socket.on('joiningRoom', async ({ roomCode }) => {
    const session = await mongoCollection.findOne({
      room: roomCode,
    });
    if (!session) {
      // Add 'no room made with this ID'
      return;
    }
    socket.join(roomCode);
    await mongoCollection.updateOne(
      { room: roomCode },
      { $push: { members: socket.id } }
    );
    const { members, turn, wordList } = session;
    socket.emit('word', wordList[turn % members.length]);
  });

  socket.on('checkSpelling', ({ attempt, word }, callback) => {
    if (attempt === word) {
      callback(true);
      return;
    }
    callback(false);
  });

  socket.on('nextTurn', async (arg, callback) => {
    const roomCode = [...socket.rooms][1];
    const clients = [...io.sockets.adapter.rooms.get(roomCode)];
    const {
      value: { turn: turnBeforeInc, wordList },
    } = await mongoCollection.findOneAndUpdate(
      { room: roomCode },
      { $inc: { turn: 1 } }
    );
    const turn = turnBeforeInc + 1;
    // This gets the person's turn;
    const whosTurn = clients[turn % clients.length];
    const nextWord = wordList[turn];
    io.to(roomCode).emit('nextWord', { nextWord, whosTurn });
  });

  socket.on('disconnecting', async () => {
    const roomCode = [...socket.rooms][1];
    await mongoCollection.findOneAndUpdate(
      { room: roomCode },
      { $pull: { members: socket.id } }
    );
    await mongoCollection.deleteOne({
      room: roomCode,
      members: { $exists: true, $size: 0 },
    });
  });
});

server.listen(5000, () => {
  console.log('listening on port 5000');
});
