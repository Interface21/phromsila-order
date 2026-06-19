const fs = require('fs');

const files = [
  'AdminJs.html',
  'admin.js',
  'CustomerJs.html',
  'app.js',
];

const target = "Swal.showLoading();";
const replacement = "Swal.fire({title: 'กำลังประมวลผล', text: 'กรุณารอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});";

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Need to use regex to replace with arbitrary spaces before the semi-colon if any, 
  // but let's just replace the exact string or regex \bSwal\.showLoading\(\)\s*;
  content = content.replace(/Swal\.showLoading\(\)\s*;/g, replacement);
  fs.writeFileSync(file, content);
  console.log('Replaced in ' + file);
}
