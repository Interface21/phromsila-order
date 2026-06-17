const API_URL = 'https://script.google.com/macros/s/AKfycbx3xt9rxmfiyb8l1I6Ic3V119IByVLwTr4Dxv6ZQDZgXAv1uBz8KjNGxNcn59eKAbeyXQ/exec';

async function test() {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getConfig', data: [] })
  });
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Body:', text);
}

test();
