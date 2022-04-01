import * as fs from 'fs/promises';

export default async function getWords(numberOfWords = 100) {
  const file = await fs.readFile('words.json');
  const wordList = JSON.parse(file);
  const indicesOfWords = [...new Array(numberOfWords)].map(() =>
    Math.round(Math.random() * wordList.length)
  );
  const words = indicesOfWords.map((index) => wordList[index]);
  return words;
}
