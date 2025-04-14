# 🤖 mcp-ollama-beeai
A minimal client app to interact with local [OLLAMA](https://ollama.com/) models leveraging multiple [MCP](https://modelcontextprotocol.io/introduction) agent tools using [BeeAI](https://github.com/i-am-bee) framework.

> Below is a sample visual of this client app with chat interface, displaying the postgres database operation performed with thinking steps the AI has taken to use the right MCP agent and tranforming the request & response with LLM:

![Demo Picture](https://raw.githubusercontent.com/tamdilip/mcp-ollama-beeai/refs/heads/main/docs/demo-pic.png)

## Usage

### 📋 Pre-requisite

#### 1. Local ollama server
Install and serve ollama in your local machine with the following commands.
 
- Make sure you have enough memory available in your machine, atleast 16GB RAM for models to perform.
- Skip this installation in your local, if you're going to use a remote server for model.

```
        $ curl -fsSL https://ollama.com/install.sh | sh
        $ ollama serve
        $ ollama pull llama3.1
``` 

#### 2. MCP servers list configuration

Add your MCP agents in the `mcp-servers.json` file in root folder, for the app to pickup and work along with the LLM.

- Default servers included are [postgres](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres)  and [fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch). `Make sure to update you postgres connection URL`
- List of other MCP agent tools availabe for configuration - https://modelcontextprotocol.io/examples 


#### 3 .env
If you want to use a different LLM model and LLM server, override the below properties before `npm start`

```
        OLLAMA_CHAT_MODEL=llama3.1
        OLLAMA_BASE_URL=http://localhost:11434/api
``` 

### 🎮 Boot up your app
```
        $ git clone https://github.com/tamdilip/mcp-ollama-beeai.git
        $ cd mcp-ollama-beeai
        $ npm i
        $ npm start
``` 

Once the app is up and running, hit in Browser -> http://localhost:3000

#### Additional Context:
- By default on landing no MCP agent is referred for the questions.
- The respective MCP agent to be used a question can be selected from the `Server` & `tools` dropdown in UI.
- `BeeAI` framework is used for ease setup of `ReAct` (Reason And Act) agent with MCP tools.
- `Markdown` JS library is used to render the responses in proper readable visual format.


**Happy coding :) !!**
