const { app } = require('electron');

app.whenReady().then(async () => {
  const { generateTitle } = await import('./sheet/ai-title.js');
  
  console.log('=== Test AI Title với API key ===');
  
  const result = await generateTitle({
    apiKey: 'AIzaSyB8RN6L-weYobVoKolC8XNeClMDZWZd4GnyGk0X-zld-a6yTxA',
    model: 'gemini-2.0-flash',
    fileTitle: "Nhạc lofi thư giãn khi học bài",
    topic: "nhạc lofi, thư giãn, tập trung",
    language: "Tiếng Việt",
    style: "seo",
    maxLength: 70,
    count: 3
  });
  
  if (result.ok) {
    console.log('>>> SUCCESS <<<');
    console.log('Title:', result.title);
    console.log('Candidates:', result.candidates);
  } else {
    console.log('>>> FAILED <<<');
    console.log('Error:', result.error);
    console.log('Code:', result.code);
    if (result.detail) console.log('Detail:', result.detail);
  }
  
  app.quit();
});
