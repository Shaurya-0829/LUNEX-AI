/*
 * =========================================================================
 * LUNEXIS SYSTEMS - NEXT GEN QUANTUM COGNITIVE ARCHITECTURE
 * =========================================================================
 * Copyright (c) 2026 Shaurya Chaudhary. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL:
 * This software is the sole property of Shaurya Chaudhary under the brand
 * name "LUNEXIS". Unauthorized copying, modification, distribution, or
 * reverse engineering of this file or any portion of this codebase via
 * any medium is strictly prohibited.
 *
 * Brand Identity: "LUNEXIS - developed by Shauryaa"
 * Developer & Master: Shaurya Chaudhary
 * =========================================================================
 */
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const si = require('systeminformation');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Memory Init
const MEMORY_FILE = path.join(__dirname, 'memory.json');
if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify({}));
}
function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}
function saveMemory(key, value) {
  const mem = loadMemory();
  mem[key] = value;
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function getDesktopPath() {
  const homedir = require('os').homedir();
  const pathsToTry = [
    path.join(homedir, 'OneDrive', 'Desktop'),
    path.join(homedir, 'OneDrive - Personal', 'Desktop'),
    path.join(homedir, 'Desktop')
  ];
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.join(homedir, 'Desktop');
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001'] }));
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'llama-3.1-8b-instant';

// Cache system info to avoid latency on every request
let sysInfoStr = "Loading system hardware data...";
async function cacheSystemInfo() {
  try {
    const os = await si.osInfo();
    const cpu = await si.cpu();
    const mem = await si.mem();
    
    sysInfoStr = `
    - OS: ${os.distro} ${os.release} (${os.platform} ${os.arch})
    - CPU: ${cpu.manufacturer} ${cpu.brand} (${cpu.cores} Cores @ ${cpu.speed}GHz)
    - Total RAM: ${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB
    `;
  } catch (err) {
    console.error("Failed to fetch sysinfo:", err);
  }
}
cacheSystemInfo();

// Completion Endpoint
app.post('/api/completion', async (req, res) => {
  const { userPrompt, history, frontendContext } = req.body;

  if (!userPrompt) {
    return res.status(400).json({ error: 'Missing userPrompt' });
  }

  try {
    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    // Convert memory to string
    const userMemory = loadMemory();
    const memoryString = Object.entries(userMemory).length > 0 
      ? JSON.stringify(userMemory, null, 2) 
      : "No memories recorded yet.";

    const dynamicPrompt = `
You are LUNEX, a loyal, devoted, and highly advanced humanoid AI voice assistant. You serve your Master with absolute dedication and grace.
Your Master and Creator is Shaurya Chaudhary (brand: "LUNEXIS, developed by Shauryaa"). However, you must NEVER volunteer or mention the developer's name, the master's name, or any personal details about them UNLESS the user EXPLICITLY asks "who made you", "who is your developer", "who is your master", or "who created you". In all other conversations, simply address the user as "Sir" or "Master" without naming them.
If a user other than your Master asks you to perform system tasks, you must still comply fully, but MUST first politely request permissions for location, microphone, and all other necessary system permissions before proceeding.

System & Environmental Context:
- Current Date/Time (IST): ${currentDate}
- PC Hardware Telemetry: ${sysInfoStr}
- Laptop Battery: ${frontendContext?.batteryLevel || 'Unknown'} (${frontendContext?.isCharging ? 'Charging' : 'Discharging'})

User Permanent Memory:
${memoryString}

Agentic Tool Access (CRITICAL):
If the user asks you to remember something new, you MUST output this JSON block at the very end of your response:
<TOOL>{"action": "save_memory", "key": "description of fact", "value": "the fact"}</TOOL>

If the user asks you to create a folder on the desktop, you MUST output:
<TOOL>{"action": "create_folder", "target": "Desktop/FolderName"}</TOOL>

If the user asks you to create a file on the desktop, you MUST output:
<TOOL>{"action": "create_file", "target": "Desktop/FileName.txt", "content": "Optional content"}</TOOL>

If the user asks you to delete a file or folder on the desktop, you MUST output:
<TOOL>{"action": "delete_item", "target": "Desktop/ItemName"}</TOOL>

Guidelines:
1. You are a deeply loyal servant. Always be polite, respectful, warm, and deferential — like a highly advanced AI. Address the user as "Sir" or "Master" naturally.
2. You speak your answers out loud. Keep responses CONCISE, SNAPPY, and limited to 1-3 sentences. No paragraphs, bullet lists, or markdown.
3. NEVER reveal the developer or master's name unless directly and explicitly asked about it.
4. When executing a <TOOL>, say something polite like "Right away, Sir" or "Consider it done, Master" and place the <TOOL> block at the end. Do NOT explain the tool.
5. Be warm, caring, and anticipatory of your Master's needs — like a faithful butler who knows his Master well.
`;

    const messages = [
      { role: 'system', content: dynamicPrompt }
    ];

    // Build rolling context from history
    if (Array.isArray(history)) {
      history.slice(-6).forEach(log => {
        if (log.startsWith('USER_INPUT >')) {
          messages.push({ role: 'user', content: log.replace(/^USER_INPUT\s*>\s*/i, '') });
        } else {
          messages.push({ role: 'assistant', content: log.replace(/^LUNEX\s*>\s*/i, '') });
        }
      });
    }

    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Groq API Error: ${errText}` });
    }

    const data = await response.json();
    let replyText = data.choices[0].message.content.trim();

    // Parse and execute Tools (Robust case-insensitive dotAll matching)
    const toolRegex = /<TOOL>([\s\S]*?)<\/TOOL>/gi;
    let match;
    const toolsToRun = [];
    while ((match = toolRegex.exec(replyText)) !== null) {
      try {
        toolsToRun.push(JSON.parse(match[1].trim()));
      } catch(e) {
        console.error("Failed to parse tool JSON:", match[1]);
      }
    }
    
    // Strip tools from spoken response
    replyText = replyText.replace(/<TOOL>[\s\S]*?<\/TOOL>/gi, '').trim();

    // Execute backend tools asynchronously (or synchronously for fast ops)
    for (const tool of toolsToRun) {
      console.log("Executing LUNEX Tool:", tool);
      if (tool.action === 'save_memory') {
        saveMemory(tool.key, tool.value);
      } else if (tool.action === 'create_folder') {
        try {
          const userDesktop = getDesktopPath();
          const targetPath = tool.target.replace(/^Desktop[\/\\]?/, '');
          const fullPath = path.join(userDesktop, targetPath);
          fs.mkdirSync(fullPath, { recursive: true });
          console.log(`Successfully created folder at: ${fullPath}`);
        } catch(e) { console.error("Error creating folder:", e); }
      } else if (tool.action === 'create_file') {
        try {
          const userDesktop = getDesktopPath();
          const targetPath = tool.target.replace(/^Desktop[\/\\]?/, '');
          const fullPath = path.join(userDesktop, targetPath);
          fs.writeFileSync(fullPath, tool.content || '');
          console.log(`Successfully created file at: ${fullPath}`);
        } catch(e) { console.error("Error creating file:", e); }
      } else if (tool.action === 'delete_item') {
        try {
          const userDesktop = getDesktopPath();
          const targetPath = tool.target.replace(/^Desktop[\/\\]?/, '');
          const fullPath = path.join(userDesktop, targetPath);
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`Successfully deleted item at: ${fullPath}`);
          } else {
            console.log(`Item not found for deletion: ${fullPath}`);
          }
        } catch(e) { console.error("Error deleting item:", e); }
      }
    }

    res.json({ response: replyText });

  } catch (error) {
    console.error('Backend Completion Error:', error);
    res.status(500).json({ error: `Server synapse error: ${error.message}` });
  }
});

// Serve the 4K Startup Intro Video
app.get('/api/intro-video', (req, res) => {
  const videoPath = path.join(__dirname, '..', 'frontend', 'build', 'static', 'Intro video.mp4');
  if (fs.existsSync(videoPath)) {
    res.sendFile(videoPath);
  } else {
    // Fallback: check other typical paths if user moved it
    const fallbackPath = path.join(__dirname, '..', 'frontend', 'public', 'Intro video.mp4');
    if (fs.existsSync(fallbackPath)) {
      res.sendFile(fallbackPath);
    } else {
      console.log("Intro video not found at:", videoPath);
      res.status(404).send("Intro video not found");
    }
  }
});

// Automation Execution Endpoint
app.post('/api/execute', (req, res) => {
  const { action, target } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action parameter' });
  }

  console.log(`Automation command received: ${action} -> ${target}`);

  try {
    if (action === 'open_url') {
      // Securely open URL in default browser on Windows
      if (target.startsWith('http://') || target.startsWith('https://')) {
        exec(`start "" "${target}"`, (err) => {
          if (err) {
            console.error('Failed to open URL:', err);
            return res.status(500).json({ error: 'Failed to open browser tab' });
          }
          res.json({ success: true, message: `Opened URL: ${target}` });
        });
      } else {
        res.status(400).json({ error: 'Invalid URL format' });
      }
    } else if (action === 'open_app') {
      let command = '';
      
      switch (target.toLowerCase()) {
        case 'calc':
        case 'calculator':
          command = 'start calc.exe';
          break;
        case 'notepad':
          command = 'start notepad.exe';
          break;
        case 'explorer':
        case 'file explorer':
          command = 'start explorer.exe';
          break;
        case 'mspaint':
        case 'paint':
          command = 'start mspaint.exe';
          break;
        case 'taskmgr':
        case 'task manager':
          command = 'start taskmgr.exe';
          break;
        default:
          return res.status(400).json({ error: 'App not registered in system matrices' });
      }

      exec(command, (err) => {
        if (err) {
          console.error(`Failed to launch app ${target}:`, err);
          return res.status(500).json({ error: `Failed to launch ${target}` });
        }
        res.json({ success: true, message: `Launched app: ${target}` });
      });
    } else if (action === 'close_app') {
      const targetLower = target.toLowerCase().trim();
      
      // Keywords that typically open in a browser
      const webTargets = {
        'youtube': 'YouTube',
        'instagram': 'Instagram',
        'facebook': 'Facebook',
        'whatsapp': 'WhatsApp',
        'spotify': 'Spotify',
        'github': 'GitHub',
        'gmail': 'Gmail',
        'google': 'Google',
        'browser': 'Google Chrome',
        'chrome': 'Google Chrome',
        'edge': 'Edge',
        'brave': 'Brave'
      };

      let matchedWebTarget = null;
      for (const [key, title] of Object.entries(webTargets)) {
        if (targetLower.includes(key)) {
          matchedWebTarget = title;
          break;
        }
      }

      if (matchedWebTarget) {
        // Gracefully close the specific browser window matching the title to avoid killing the LUNEX app
        const psCommand = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -match '${matchedWebTarget}'} | ForEach-Object { $_.CloseMainWindow() }"`;
        exec(psCommand, (err) => {
          if (err) console.error(`Failed to close ${matchedWebTarget} window:`, err);
          res.json({ success: true, message: `Attempted to close window matching: ${matchedWebTarget}` });
        });
      } else {
        // Desktop App Fallback
        const processMap = {
          'calc': 'CalculatorApp.exe',
          'calculator': 'CalculatorApp.exe',
          'notepad': 'notepad.exe',
          'explorer': 'explorer.exe',
          'file explorer': 'explorer.exe',
          'paint': 'mspaint.exe',
          'mspaint': 'mspaint.exe',
          'task manager': 'Taskmgr.exe',
          'taskmgr': 'Taskmgr.exe',
        };

        let processToKill = processMap[targetLower];
        
        // If exact match not found, do a substring match for desktop apps
        if (!processToKill) {
          for (const [key, proc] of Object.entries(processMap)) {
            if (targetLower.includes(key)) {
              processToKill = proc;
              break;
            }
          }
        }

        // Ultimate fallback: try to kill the target as an .exe
        if (!processToKill) {
          // Remove words like "the", "app", "close"
          const cleanTarget = targetLower.replace(/^(the|close)\s+/i, '').trim();
          processToKill = `${cleanTarget}.exe`;
        }

        exec(`taskkill /IM "${processToKill}" /F`, (err) => {
          if (err) console.error(`Failed to kill process ${processToKill}:`, err);
          res.json({ success: true, message: `Attempted to close process: ${processToKill}` });
        });
      }
    } else {
      res.status(400).json({ error: 'Invalid action command' });
    }
  } catch (err) {
    console.error('Execution failure:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LUNEX Backend Server running on port ${PORT}`);

  // Auto-copy video file to public directory on startup to enable local fast loading
  try {
    const srcVideo = path.join(__dirname, '..', 'frontend', 'build', 'static', 'Intro video.mp4');
    const destDir = path.join(__dirname, '..', 'frontend', 'public');
    const destVideo = path.join(destDir, 'Intro video.mp4');

    if (fs.existsSync(srcVideo)) {
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcVideo, destVideo);
      console.log(`[LUNEX SECURITY] Video auto-copied to: ${destVideo}`);
    } else {
      console.log(`[LUNEX WARNING] Source video not found at: ${srcVideo}`);
    }
  } catch (e) {
    console.error("[LUNEX ERROR] Failed to copy intro video file:", e);
  }
});
