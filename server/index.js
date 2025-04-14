import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { UnconstrainedMemory } from 'beeai-framework/memory/unconstrainedMemory';
import { OllamaChatModel } from 'beeai-framework/adapters/ollama/backend/chat';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReActAgent } from 'beeai-framework/agents/react/agent';
import { MCPTool } from 'beeai-framework/tools/mcp';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import express from 'express';
import path from 'path';
import 'dotenv/config';
import fs from 'fs';


const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../ui')));

const getAllMCPTools = async () => {
    const serverConfigData = fs.readFileSync('./mcp-servers.json', 'utf8');
    const { mcpServers } = JSON.parse(serverConfigData);

    const serverTools = {};
    const allTools = [];
    for (const [serverName, serverPath] of Object.entries(mcpServers)) {
        const client = new Client({ name: serverName, version: '1.0.0' }, { capabilities: {} });
        await client.connect(new StdioClientTransport(serverPath));
        console.log('Connected to MCP server:', serverName);
        const clientTools = await MCPTool.fromClient(client);
        serverTools[serverName] = {
            name: serverName,
            tools: clientTools.map((tool) => tool.name),
        };
        allTools.push(...clientTools);
    }

    return { serverTools, allTools };
};

const { serverTools, allTools } = await getAllMCPTools();
const llm = new OllamaChatModel();

// Set up WebSocket server
const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');

    let isProcessing = false;
    let cancelProcessing = false;
    let memory = new UnconstrainedMemory();
    let agent = new ReActAgent({
        llm,
        memory,
        tools: allTools,
    });

    // Send MCP servers and their tools to client
    ws.send(JSON.stringify({ event: 'server_tool_list', servers: serverTools }));

    // Keep-alive ping
    const keepAlive = setInterval(() => {
        if (ws.isAlive === false) {
            clearInterval(keepAlive);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            const { query, action, toolName, serverName } = data;

            if (action === 'stop') {
                if (isProcessing) {
                    console.log('Received stop request');
                    cancelProcessing = true;
                    isProcessing = false;
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: allTools,
                    });
                    ws.send(JSON.stringify({ event: 'stopped', message: 'Processing stopped by user' }));
                }
                return;
            }

            if (action === 'new_chat') {
                console.log('Received new chat request');
                if (isProcessing) {
                    cancelProcessing = true;
                    isProcessing = false;
                    await new Promise((resolve) => setTimeout(resolve, 200));
                }
                memory = new UnconstrainedMemory();
                agent = new ReActAgent({
                    llm,
                    memory,
                    tools: allTools,
                });
                ws.send(JSON.stringify({ event: 'new_chat', message: 'New chat started' }));
                return;
            }

            if (action === 'get_tools') {
                if (serverName === 'none') {
                    console.log('Sending empty tools for "None" server');
                    ws.send(JSON.stringify({ event: 'tools_for_server', tools: [] }));
                    return;
                }
                if (serverName === 'all') {
                    const allServerTools = Object.values(serverTools).flatMap((server) => server.tools);
                    console.log('Sending all tools for "All Servers":', allServerTools);
                    ws.send(JSON.stringify({ event: 'tools_for_server', tools: allServerTools }));
                    return;
                }
                if (!serverName || !serverTools[serverName]) {
                    console.log('Invalid server name:', serverName);
                    ws.send(JSON.stringify({ event: 'tools_for_server', tools: [], error: 'Invalid server name' }));
                    return;
                }
                console.log('Sending tools for server:', serverName, serverTools[serverName].tools);
                ws.send(JSON.stringify({ event: 'tools_for_server', tools: serverTools[serverName].tools }));
                return;
            }

            if (!query || typeof query !== 'string') {
                console.error('Invalid query:', query);
                ws.send(JSON.stringify({ error: 'Invalid or missing query' }));
                return;
            }

            if (isProcessing) {
                ws.send(JSON.stringify({ error: 'Another query is being processed' }));
                return;
            }

            if (!serverName) {
                console.error('No server selected');
                ws.send(JSON.stringify({ error: 'Please select a server or None' }));
                return;
            }

            console.log('Received query:', query, 'with server:', serverName || 'none', 'tool:', toolName || 'none');
            isProcessing = true;
            cancelProcessing = false;

            // Update agent tools based on serverName and toolName
            if (serverName === 'none') {
                agent = new ReActAgent({
                    llm,
                    memory,
                    tools: [],
                });
            } else if (serverName === 'all') {
                if (toolName && toolName !== 'none' && toolName !== 'all') {
                    const selectedTool = allTools.find((tool) => tool.name === toolName);
                    if (!selectedTool) {
                        ws.send(JSON.stringify({ error: `Tool '${toolName}' not found` }));
                        isProcessing = false;
                        return;
                    }
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: [selectedTool],
                    });
                } else {
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: toolName === 'none' ? [] : allTools,
                    });
                }
            } else if (serverTools[serverName]) {
                if (toolName && toolName !== 'none' && toolName !== 'all') {
                    const selectedTool = allTools.find((tool) => tool.name === toolName && serverTools[serverName].tools.includes(tool.name));
                    if (!selectedTool) {
                        ws.send(JSON.stringify({ error: `Tool '${toolName}' not found for server '${serverName}'` }));
                        isProcessing = false;
                        return;
                    }
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: [selectedTool],
                    });
                } else {
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: toolName === 'none' ? [] : toolName === 'all' ? allTools : allTools.filter((tool) => serverTools[serverName].tools.includes(tool.name)),
                    });
                }
            } else {
                ws.send(JSON.stringify({ error: `Invalid server '${serverName}'` }));
                isProcessing = false;
                return;
            }

            await agent.run({ prompt: query }).observe((emitter) => {
                emitter.on('update', async ({ update }) => {
                    if (cancelProcessing) {
                        emitter.emit('end');
                        return;
                    }
                    const { key, value } = update;
                    if (key && value) {
                        const markdownValue = key !== 'final_answer' ? `- **${key}**: ${value}` : value;
                        console.log('Sending update:', { key, value: markdownValue });
                        try {
                            ws.send(JSON.stringify({ key, value: markdownValue }));
                            if (key === 'final_answer') {
                                emitter.emit('end');
                            }
                        } catch (sendError) {
                            console.error('Error sending WebSocket message:', sendError);
                            ws.send(JSON.stringify({ error: 'WebSocket send error' }));
                        }
                    }
                });

                emitter.on('end', () => {
                    console.log('Processing ended');
                    isProcessing = false;
                    cancelProcessing = false;
                    ws.send(JSON.stringify({ event: 'end', message: 'Stream completed' }));
                });

                emitter.on('error', (error) => {
                    console.error('Emitter error:', error);
                    isProcessing = false;
                    cancelProcessing = false;
                    agent = new ReActAgent({
                        llm,
                        memory,
                        tools: allTools,
                    });
                    ws.send(JSON.stringify({ error: error.message || 'Error processing query' }));
                    ws.send(JSON.stringify({ event: 'end', message: 'Stream completed' }));
                });
            });
        } catch (error) {
            console.error('Query processing error:', error);
            isProcessing = false;
            cancelProcessing = false;
            agent = new ReActAgent({
                llm,
                memory,
                tools: allTools,
            });
            ws.send(JSON.stringify({ error: error.message || 'Internal server error' }));
            ws.send(JSON.stringify({ event: 'end', message: 'Stream completed' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        isProcessing = false;
        cancelProcessing = true;
        clearInterval(keepAlive);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        isProcessing = false;
        cancelProcessing = true;
    });
});