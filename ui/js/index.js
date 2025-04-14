document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const serverSelect = document.getElementById('server-select');
    const toolSelect = document.getElementById('tool-select');
    const loading = document.getElementById('loading');
    const toggleTheme = document.getElementById('toggle-theme');
    const newChatButton = document.getElementById('new-chat-button');
    const clearChatButton = document.getElementById('clear-chat-button');

    let ws;
    let thinkingDiv = null;
    let finalMessageDiv = null;
    let isExpanded = true;
    let isProcessing = false;
    let isToolsLoading = false;
    let lastUserMessage = null;
    let editingMessage = null;
    let allTools = [];

    // Initialize dropdowns
    serverSelect.value = 'none';
    toolSelect.value = 'none';
    toolSelect.disabled = true;
    sendButton.disabled = true;

    // Theme toggle
    toggleTheme.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        toggleTheme.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
    });

    // Stop ongoing request
    function stopRequest() {
        if (isProcessing && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({ action: 'stop' }));
                return new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        console.warn('Stop request timed out');
                        isProcessing = false;
                        cleanupOnError();
                        appendMessage('Stop request timed out', 'error');
                        resolve();
                    }, 3000);
                    const checkStopped = setInterval(() => {
                        if (!isProcessing) {
                            clearInterval(checkStopped);
                            clearTimeout(timeout);
                            resolve();
                        }
                    }, 100);
                });
            } catch (error) {
                console.error('Error sending stop message:', error);
                appendMessage('Failed to send stop request', 'error');
                return Promise.resolve();
            }
        }
        return Promise.resolve();
    }

    // New chat
    newChatButton.addEventListener('click', async () => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                await stopRequest();
                ws.send(JSON.stringify({ action: 'new_chat' }));
                chatMessages.innerHTML = '';
                lastUserMessage = null;
            } catch (error) {
                console.error('Error sending new chat request:', error);
                appendMessage('Failed to start new chat', 'error');
            }
        } else {
            appendMessage('WebSocket not connected. Please try again.', 'error');
        }
    });

    // Clear chat
    clearChatButton.addEventListener('click', async () => {
        await stopRequest();
        chatMessages.innerHTML = '';
        thinkingDiv = null;
        finalMessageDiv = null;
        lastUserMessage = null;
    });

    // Initialize WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket data:', data);

                if (data.event === 'server_tool_list') {
                    populateServerSelect(data.servers);
                    allTools = Object.values(data.servers).flatMap((server) => server.tools);
                    return;
                }

                if (data.event === 'tools_for_server') {
                    toolSelect.classList.remove('loading');
                    isToolsLoading = false;
                    updateSendButtonState();
                    toolSelect.innerHTML = '<option value="none">None</option><option value="all">All Tools</option>';
                    if (data.tools && data.tools.length > 0) {
                        data.tools.forEach((tool) => {
                            const option = document.createElement('option');
                            option.value = tool;
                            option.textContent = tool;
                            toolSelect.appendChild(option);
                        });
                        toolSelect.value = 'all';
                        toolSelect.disabled = false;
                    } else {
                        toolSelect.disabled = false;
                        toolSelect.value = 'all';
                        if (data.error) {
                            appendMessage(data.error, 'error');
                        }
                    }
                    return;
                }

                if (data.event === 'new_chat') {
                    appendMessage('New chat started', 'bot');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    return;
                }

                if (data.error) {
                    cleanupOnError();
                    appendMessage(data.error, 'error');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    return;
                }

                if (data.event === 'end' || data.event === 'stopped') {
                    removeSpinner(thinkingDiv, '.loading-spinner-container');
                    removeTypingAnimation(finalMessageDiv);
                    loading.style.display = 'none';
                    if (thinkingDiv) {
                        const header = thinkingDiv.querySelector('.thinking-header');
                        const content = thinkingDiv.querySelector('.thinking-content');
                        header.classList.add('collapsed', 'collapsible');
                        content.classList.add('collapsed');
                        isExpanded = false;
                    }
                    if (data.event === 'stopped') {
                        appendMessage('Processing stopped by user', 'error');
                    }
                    resetProcessingState();
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    return;
                }

                removeSpinner(thinkingDiv, '.loading-spinner-container');

                if (data.key === 'final_answer') {
                    finalMessageDiv.innerHTML = marked.parse(data.value || '');
                    removeTypingAnimation(finalMessageDiv);
                    if (thinkingDiv) {
                        const header = thinkingDiv.querySelector('.thinking-header');
                        const content = thinkingDiv.querySelector('.thinking-content');
                        header.classList.add('collapsed', 'collapsible');
                        content.classList.add('collapsed');
                        isExpanded = false;
                    }
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else {
                    if (!thinkingDiv) {
                        thinkingDiv = createThinkingSteps();
                        chatMessages.insertBefore(thinkingDiv, finalMessageDiv);
                    }
                    console.log('Adding thought item:', data.value);
                    addThoughtItem(thinkingDiv.querySelector('.thinking-content'), data.value || '');
                    addSpinner(thinkingDiv.querySelector('.thinking-content'), 'loading-spinner-container');
                    const contentDiv = thinkingDiv.querySelector('.thinking-content');
                    contentDiv.scrollTop = contentDiv.scrollHeight;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                cleanupOnError();
                appendMessage('Error processing server response', 'error');
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        };

        ws.onclose = () => {
            console.log('WebSocket closed. Attempting to reconnect...');
            cleanupOnError();
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            cleanupOnError();
            appendMessage('Connection error occurred', 'error');
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };
    }

    connectWebSocket();

    // Populate server dropdown
    function populateServerSelect(servers) {
        serverSelect.innerHTML = '<option value="none">None</option><option value="all">All Servers</option>';
        Object.values(servers).forEach((server) => {
            const option = document.createElement('option');
            option.value = server.name;
            option.textContent = server.name;
            serverSelect.appendChild(option);
        });
        serverSelect.value = 'none';
        toolSelect.disabled = true;
        updateSendButtonState();
    }

    // Handle server selection
    serverSelect.addEventListener('change', () => {
        const serverName = serverSelect.value;
        toolSelect.innerHTML = '<option value="none">None</option><option value="all">All Tools</option>';
        toolSelect.value = serverName === 'none' ? 'none' : 'all';
        toolSelect.disabled = serverName === 'none';
        isToolsLoading = serverName !== 'none' && serverName !== 'all';
        updateSendButtonState();
        if (serverName === 'all') {
            toolSelect.innerHTML = '<option value="none">None</option><option value="all">All Tools</option>';
            allTools.forEach((tool) => {
                const option = document.createElement('option');
                option.value = tool;
                option.textContent = tool;
                toolSelect.appendChild(option);
            });
            toolSelect.value = 'all';
            toolSelect.disabled = false;
            isToolsLoading = false;
            updateSendButtonState();
        } else if (serverName && serverName !== 'none') {
            toolSelect.classList.add('loading');
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'get_tools', serverName }));
            } else {
                toolSelect.classList.remove('loading');
                isToolsLoading = false;
                updateSendButtonState();
                appendMessage('WebSocket not connected. Please try again.', 'error');
            }
        }
    });

    // Update send button state
    function updateSendButtonState() {
        sendButton.disabled = isProcessing || isToolsLoading || !userInput.value.trim();
    }

    // Monitor user input
    userInput.addEventListener('input', () => {
        updateSendButtonState();
    });

    // Monitor tool-select changes
    toolSelect.addEventListener('change', () => {
        console.log('Tool selected:', toolSelect.value);
        updateSendButtonState();
    });

    // Send message
    sendButton.addEventListener('click', () => {
        if (!sendButton.disabled) {
            sendMessage();
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !sendButton.disabled) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Stop processing
    stopButton.addEventListener('click', async () => {
        await stopRequest();
    });

    function toggleInputState(disable) {
        userInput.disabled = disable;
        serverSelect.disabled = disable;
        toolSelect.disabled = disable || serverSelect.value === 'none';
        stopButton.style.display = disable ? 'block' : 'none';
        updateSendButtonState();
    }

    function resetProcessingState() {
        isProcessing = false;
        toggleInputState(false);
    }

    async function sendMessage(editedMessage = null) {
        const query = editedMessage || userInput.value.trim();
        if (!query) return;

        if (ws.readyState !== WebSocket.OPEN) {
            appendMessage('WebSocket not connected. Please try again.', 'error');
            return;
        }

        if (isProcessing) {
            appendMessage('Please wait for the current query to finish or stop it.', 'error');
            return;
        }

        if (isToolsLoading) {
            appendMessage('Please wait for tools to load.', 'error');
            return;
        }

        const serverName = serverSelect.value;
        if (!serverName) {
            appendMessage('Please select a server or None', 'error');
            return;
        }

        isProcessing = true;
        toggleInputState(true);
        if (!editedMessage) {
            lastUserMessage = appendMessage(query, 'user', true);
            userInput.value = '';
        } else {
            lastUserMessage.textContent = query;
            lastUserMessage.classList.add('user');
        }
        finalMessageDiv = appendMessage('', 'bot');
        addTypingAnimation(finalMessageDiv);
        thinkingDiv = null;
        loading.style.display = 'block';

        try {
            const toolName = toolSelect.value || 'none';
            console.log('Sending message with server:', serverName, 'tool:', toolName);
            ws.send(JSON.stringify({ query, toolName, serverName }));
        } catch (error) {
            console.error('Error sending WebSocket message:', error);
            cleanupOnError();
            appendMessage('Failed to send message', 'error');
            chatMessages.scrollTop = chatMessages.scrollHeight;
            resetProcessingState();
        }
    }

    function appendMessage(content, type, isUserMessage = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        if (type === 'bot' && content) {
            messageDiv.innerHTML = marked.parse(content);
        } else if (type === 'error') {
            messageDiv.textContent = content;
        } else {
            messageDiv.textContent = content;
        }

        if (isUserMessage && !isProcessing) {
            const editButton = document.createElement('button');
            editButton.className = 'edit-button';
            editButton.textContent = 'Edit';
            editButton.addEventListener('click', () => startEditing(messageDiv));
            messageDiv.appendChild(editButton);
        }

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageDiv;
    }

    function startEditing(messageDiv) {
        if (editingMessage || isProcessing) return;
        editingMessage = messageDiv;
        const originalText = messageDiv.textContent;
        messageDiv.innerHTML = '';

        const editContainer = document.createElement('div');
        editContainer.className = 'edit-container';

        const textarea = document.createElement('textarea');
        textarea.className = 'edit-textarea';
        textarea.value = originalText;
        textarea.rows = 2;

        const actions = document.createElement('div');
        actions.className = 'edit-actions';

        const saveButton = document.createElement('button');
        saveButton.className = 'edit-save';
        saveButton.textContent = 'Save';
        saveButton.addEventListener('click', async () => {
            const newText = textarea.value.trim();
            if (newText) {
                await stopRequest();
                messageDiv.innerHTML = '';
                messageDiv.textContent = newText;
                messageDiv.className = 'message user';
                lastUserMessage = messageDiv;
                editingMessage = null;
                sendMessage(newText);
            }
        });

        const cancelButton = document.createElement('button');
        cancelButton.className = 'edit-cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
            messageDiv.innerHTML = '';
            messageDiv.textContent = originalText;
            messageDiv.className = 'message user';
            const editButton = document.createElement('button');
            editButton.className = 'edit-button';
            editButton.textContent = 'Edit';
            editButton.addEventListener('click', () => startEditing(messageDiv));
            messageDiv.appendChild(editButton);
            editingMessage = null;
        });

        actions.appendChild(saveButton);
        actions.appendChild(cancelButton);
        editContainer.appendChild(textarea);
        editContainer.appendChild(actions);
        messageDiv.appendChild(editContainer);

        textarea.focus();
    }

    function createThinkingSteps() {
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-steps';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'thinking-header';
        headerDiv.textContent = 'Thinking Steps';
        thinkingDiv.appendChild(headerDiv);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'thinking-content';
        thinkingDiv.appendChild(contentDiv);

        headerDiv.addEventListener('click', () => {
            if (headerDiv.classList.contains('collapsible')) {
                const isCollapsed = headerDiv.classList.toggle('collapsed');
                contentDiv.classList.toggle('collapsed', isCollapsed);
            }
        });

        return thinkingDiv;
    }

    function addThoughtItem(contentDiv, value) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'thought-item';
        itemDiv.innerHTML = marked.parse(value);
        contentDiv.appendChild(itemDiv);
    }

    function addSpinner(container, className) {
        if (!container) return null;
        removeSpinner(container, '.' + className);
        const spinnerDiv = document.createElement('div');
        spinnerDiv.className = className;
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        spinnerDiv.appendChild(spinner);
        container.appendChild(spinnerDiv);
        container.scrollTop = container.scrollHeight;
        return spinnerDiv;
    }

    function removeSpinner(container, className) {
        if (container) {
            const spinnerDiv = container.querySelector(className);
            if (spinnerDiv) {
                spinnerDiv.remove();
            }
        }
    }

    function addTypingAnimation(container) {
        if (!container) return null;
        const typingDiv = document.createElement('div');
        typingDiv.className = 'bot-typing active';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            typingDiv.appendChild(dot);
        }
        container.appendChild(typingDiv);
        return typingDiv;
    }

    function removeTypingAnimation(container) {
        if (container) {
            const typingDiv = container.querySelector('.bot-typing');
            if (typingDiv) {
                typingDiv.remove();
            }
        }
    }

    function cleanupOnError() {
        removeSpinner(thinkingDiv, '.loading-spinner-container');
        removeTypingAnimation(finalMessageDiv);
        loading.style.display = 'none';
        resetProcessingState();
        if (thinkingDiv) {
            thinkingDiv.remove();
            thinkingDiv = null;
        }
        if (finalMessageDiv) {
            finalMessageDiv.remove();
            finalMessageDiv = null;
        }
    }
});