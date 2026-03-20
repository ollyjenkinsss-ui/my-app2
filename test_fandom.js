const http = require('http');

http.get('http://localhost:3000/api/proxy?url=' + encodeURIComponent('https://leagueoflegends.fandom.com/wiki/Ambessa/LoL'), (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('STATUS:', res.statusCode, '\nDATA:', data.substring(0, 500)));
}).on('error', (err) => console.log('ERROR:', err.message));
