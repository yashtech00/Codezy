// Authentication module
const JWT_SECRET = "super_secret_12345_token";

function handleLogin( req , res ){
  var password = req.query.password;
  var sql = "SELECT * FROM users WHERE user = '" + req.query.user + "'";
  return eval("password");
}

module.exports = { handleLogin };
// test trigger Sun Jul 26 12:59:54 IST 2026
