export default function generateCode() {
  return Array(6).fill('x').join('').replace(/x/g, () => {
    return String.fromCharCode(Math.floor(Math.random() * 26) + 65)
  })
}
