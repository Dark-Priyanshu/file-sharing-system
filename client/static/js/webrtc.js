// ======= EtherShare P2P Transfer Engine v2 =======
// Standard Mode: 64KB chunks, single channel, backpressure-based
// Advanced Mode: 256KB chunks, 3 parallel data channels, ACK-based resume
// =====================================================

const CHUNK_SIZE_STD = 64 * 1024;      // 64KB standard
const CHUNK_SIZE_ADV = 256 * 1024;     // 256KB advanced
const PARALLEL_CHANNELS = 3;           // Number of parallel streams in advanced mode
const BACKPRESSURE_THRESHOLD = 8 * 1024 * 1024; // 8MB

/**
 * P2PTransfer handles the WebRTC PeerConnection logic, 
 * data channel management, and chunking strategy for file transfers.
 */
class P2PTransfer {
    /**
     * @param {string} role - 'sender' or 'receiver'
     * @param {function} onProgress - callback for transfer progress
     * @param {function} onComplete - callback when file is fully received
     * @param {function} onError - callback for connection errors
     * @param {function} onMetadata - callback when file metadata is received
     * @param {boolean} advancedMode - whether to use multi-channel parallel transfer
     */
    constructor(role, onProgress, onComplete, onError, onMetadata, advancedMode = false) {
        this.role = role;
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        this.onError = onError;
        this.onMetadata = onMetadata;
        this.advancedMode = advancedMode;

        this.peerConnection = null;
        this.dataChannel = null;       // primary (standard mode or control)
        this.channels = [];            // parallel channels in advanced mode

        this.file = null;
        this.receivedChunks = [];
        this.receivedSize = 0;
        this.totalSize = 0;
        this.fileName = '';
        this.fileType = '';

        // Advanced mode state
        this.lastAckedOffset = 0;      // tracks resume point
        this.chunkSize = advancedMode ? CHUNK_SIZE_ADV : CHUNK_SIZE_STD;
        this.candidateQueue = [];
    }

    /**
     * Initializes the RTCPeerConnection and sets up signaling/ICE handlers.
     * @param {Object} iceServers - ICEServers configuration (STUN/TURN)
     */
    async init(iceServers) {
        this.peerConnection = new RTCPeerConnection(iceServers);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) this.onSignal({ type: 'candidate', candidate: event.candidate });
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const s = this.peerConnection.iceConnectionState;
            console.log('ICE state:', s);
            if (s === 'disconnected' || s === 'failed') {
                if ((this.role === 'receiver' && this.receivedSize < this.totalSize) ||
                    (this.role === 'sender' && this.file)) {
                    this.onError(new Error('Connection lost'));
                }
            }
        };

        if (this.role === 'sender') {
            if (this.advancedMode) {
                // Create parallel ordered channels
                this.channels = [];
                for (let i = 0; i < PARALLEL_CHANNELS; i++) {
                    const ch = this.peerConnection.createDataChannel(`fileTransfer_${i}`, { ordered: true });
                    this.channels.push(ch);
                    this._setupAdvancedSenderChannel(ch);
                }
                this.dataChannel = this.channels[0]; // primary for metadata/control
            } else {
                this.dataChannel = this.peerConnection.createDataChannel('fileTransfer');
                this._setupStandardChannel();
            }
        } else {
            // Receiver
            this.peerConnection.ondatachannel = (event) => {
                const ch = event.channel;
                if (ch.label.startsWith('fileTransfer_')) {
                    ch.binaryType = 'arraybuffer';
                    if (this.advancedMode) {
                        if (!this.channels.includes(ch)) this.channels.push(ch);
                        this._setupAdvancedReceiverChannel(ch);
                    } else {
                        this.dataChannel = ch;
                        this._setupStandardChannel();
                    }
                } else {
                    this.dataChannel = ch;
                    this._setupStandardChannel();
                }
            };
        }
    }

    // ---- STANDARD MODE ----
    _setupStandardChannel() {
        const ch = this.dataChannel;
        ch.binaryType = 'arraybuffer';

        ch.onopen = () => {
            console.log('[Standard] Channel open');
            if (this.role === 'sender' && this.file) this._sendMetadata(ch);
        };

        ch.onmessage = (event) => {
            if (typeof event.data === 'string') {
                this._handleControlMessage(JSON.parse(event.data), ch);
            } else {
                this._receiveChunk(event.data);
            }
        };

        ch.onerror = (err) => this.onError(err);
    }

    // ---- ADVANCED MODE (Sender side) ----
    _setupAdvancedSenderChannel(ch) {
        ch.binaryType = 'arraybuffer';
        ch.onopen = () => {
            console.log(`[Advanced Sender] Channel ${ch.label} open`);
            // Only the first channel sends metadata
            if (ch.label === 'fileTransfer_0') this._sendMetadata(ch);
        };
        ch.onmessage = (e) => {
            if (typeof e.data === 'string') this._handleControlMessage(JSON.parse(e.data), ch);
        };

        ch.onerror = (err) => this.onError(err);
    }

    // ---- ADVANCED MODE (Receiver side) ----
    _setupAdvancedReceiverChannel(ch) {
        ch.binaryType = 'arraybuffer';

        ch.onopen = () => console.log(`[Advanced Receiver] Channel ${ch.label} open`);

        ch.onmessage = (event) => {
            if (typeof event.data === 'string') {
                this._handleControlMessage(JSON.parse(event.data), ch);
            } else {
                this._receiveChunk(event.data);
                // Send ACK back on primary channel every 1MB for resume support
                if (this.receivedSize % (1024 * 1024) < this.chunkSize) {
                    const primary = this.channels[0];
                    if (primary && primary.readyState === 'open') {
                        primary.send(JSON.stringify({ type: 'ack', offset: this.receivedSize }));
                    }
                }
            }
        };

        ch.onerror = (err) => this.onError(err);
    }

    // ---- CONTROL MESSAGES ----
    _handleControlMessage(msg, replyChannel) {
        if (msg.type === 'metadata') {
            if (this.fileName !== msg.name || this.totalSize !== msg.size) {
                this.totalSize = msg.size;
                this.fileName = msg.name;
                this.fileType = msg.mime;
                this.receivedSize = 0;
                this.receivedChunks = [];
            }
            this.metadata = msg;
            // Secondary sync: if sender says they are advanced, we must be too
            if (msg.advanced !== undefined) {
                this.advancedMode = msg.advanced;
            }
            if (msg.chunkSize) {
                this.chunkSize = msg.chunkSize;
            }
            console.log('[Control] Metadata received:', msg);
            if (this.onMetadata) this.onMetadata(msg);
        } else if (msg.type === 'start') {
            this._startSecurely(200);
        } else if (msg.type === 'resume') {
            const offset = msg.offset || 0;
            console.log('[Control] Resuming from offset:', offset);
            this._startSecurely(200); // Use settle delay even for resume
        }
    }

    // ---- RECEIVE CHUNK ----
    _receiveChunk(data) {
        if (data.byteLength < 4) return;
        
        const view = new DataView(data);
        const index = view.getUint32(0);
        const chunkData = data.slice(4);

        if (!this.receivedChunks[index]) {
            this.receivedChunks[index] = chunkData;
            this.receivedSize += chunkData.byteLength;
            
            const totalChunks = Math.ceil(this.totalSize / this.chunkSize);
            const progress = Math.min(Math.round((this.receivedSize / this.totalSize) * 100), 99);
            this.onProgress(progress);

            // Check completion by valid chunk count
            const receivedCount = Object.keys(this.receivedChunks).length;
            if (receivedCount === totalChunks) {
                console.log('[Engine] All chunks received. Reassembling...');
                this.onProgress(100);
                this.onComplete(new Blob(this.receivedChunks, { type: this.fileType }), this.fileName);
            }
        }
    }

    // ---- SEND METADATA ----
    _sendMetadata(ch) {
        if (ch.readyState !== 'open') return;
        ch.send(JSON.stringify({
            type: 'metadata',
            name: this.file.name,
            size: this.file.size,
            mime: this.file.type,
            advanced: this.advancedMode,
            chunkSize: this.chunkSize,
            expectedChannels: this.advancedMode ? PARALLEL_CHANNELS : 1
        }));
    }

    // ---- CHANNEL SETTLE & START ----
    _startSecurely(delay = 200) {
        console.log(`[Engine] Settle delay: ${delay}ms before data burst...`);
        setTimeout(() => {
            if (this.advancedMode) {
                this._sendAdvancedChunks(0);
            } else {
                this._sendChunksStandard(0);
            }
        }, delay);
    }

    // ---- STANDARD CHUNK SENDER ----
    /**
     * Sends the file using a single data channel with backpressure handling.
     * @param {number} startOffset - byte offset to resume from
     */
    async _sendChunksStandard(startOffset = 0) {
        let offset = startOffset;
        let chunkIndex = Math.floor(startOffset / this.chunkSize);

        const sendNext = () => {
            if (offset >= this.file.size) { 
                console.log('[Standard] Transfer complete'); 
                return; 
            }
            
            const slice = this.file.slice(offset, offset + this.chunkSize);
            const reader = new FileReader();
            
            reader.onload = (e) => {
                if (this.dataChannel?.readyState !== 'open') {
                    console.error('[Standard] Channel closed prematurely');
                    return;
                }
                
                const data = e.target.result;
                const buffer = new Uint8Array(4 + data.byteLength);
                new DataView(buffer.buffer).setUint32(0, chunkIndex);
                buffer.set(new Uint8Array(data), 4);
                
                try {
                    this.dataChannel.send(buffer);
                    offset += data.byteLength;
                    chunkIndex++;
                    this.onProgress(Math.round((offset / this.file.size) * 100));
                    
                    const delay = this.dataChannel.bufferedAmount > BACKPRESSURE_THRESHOLD ? 50 : 0;
                    setTimeout(sendNext, delay);
                } catch (err) {
                    console.error('[Standard] Send error:', err);
                }
            };
            reader.readAsArrayBuffer(slice);
        };
        sendNext();
    }

    // ---- ADVANCED PARALLEL CHUNK SENDER ----
    /**
     * Sends the file using multiple parallel data channels for increased speed.
     * Splitting data into 256KB chunks and distributing across channels.
     * @param {number} startOffset - byte offset to resume from
     */
    async _sendAdvancedChunks(startOffset = 0) {
        const totalChunks = Math.ceil(this.file.size / this.chunkSize);
        const startChunk = Math.floor(startOffset / this.chunkSize);
        let sharedIndex = startChunk;

        const openChannels = this.channels.filter(ch => ch.readyState === 'open');
        console.log(`[Advanced] Spreading ${totalChunks} chunks over ${openChannels.length} open channels`);

        if (openChannels.length === 0) {
            console.error('[Advanced] No open channels to send data!');
            return;
        }

        const channelSenders = openChannels.map((ch) => {
            return new Promise((resolve) => {
                const sendNext = () => {
                    const myIndex = sharedIndex++;
                    if (myIndex >= totalChunks) { resolve(); return; }

                    const offset = myIndex * this.chunkSize;
                    const slice = this.file.slice(offset, offset + this.chunkSize);
                    const reader = new FileReader();

                    reader.onload = (e) => {
                        if (ch.readyState !== 'open') { resolve(); return; }

                        const waitAndSend = () => {
                            if (ch.bufferedAmount > BACKPRESSURE_THRESHOLD) {
                                setTimeout(waitAndSend, 30);
                            } else {
                                const data = e.target.result;
                                const buffer = new Uint8Array(4 + data.byteLength);
                                new DataView(buffer.buffer).setUint32(0, myIndex);
                                buffer.set(new Uint8Array(data), 4);

                                try {
                                    ch.send(buffer);
                                    const progress = Math.min(Math.round((sharedIndex / totalChunks) * 100), 99);
                                    this.onProgress(progress);
                                    sendNext();
                                } catch (err) {
                                    console.error('[Advanced] Channel send error:', err);
                                    resolve();
                                }
                            }
                        };
                        waitAndSend();
                    };
                    reader.readAsArrayBuffer(slice);
                };
                sendNext();
            });
        });

        await Promise.all(channelSenders);
        console.log('[Advanced] Transfer sequence finished');
    }

    // ---- PUBLIC API ----
    /**
     * Prepares the file for transfer and sends metadata to the peer.
     * @param {File} file - The file object to be sent
     */
    async startTransfer(file) {
        this.file = file;
        this.totalSize = file.size;
        this.chunkSize = this.advancedMode ? CHUNK_SIZE_ADV : CHUNK_SIZE_STD;
        console.log(`[Engine] Starting transfer setup: ${file.name} | Advanced: ${this.advancedMode}`);
        
        // Sender: Wait for primary channel to be open to send metadata
        const ch = this.advancedMode ? this.channels.find(c => c.label === 'fileTransfer_0') : this.dataChannel;
        const waitMetadata = () => {
            if (ch && ch.readyState === 'open') {
                this._sendMetadata(ch);
            } else if (ch) {
                setTimeout(waitMetadata, 100);
            }
        };
        waitMetadata();
    }

    acceptTransfer() {
        const checkAndStart = () => {
            const expectedCount = this.advancedMode ? PARALLEL_CHANNELS : 1;
            const openChannels = this.advancedMode ? 
                this.channels.filter(c => c.readyState === 'open') : 
                (this.dataChannel?.readyState === 'open' ? [this.dataChannel] : []);

            if (openChannels.length >= expectedCount) {
                console.log(`[Engine] Receiver ready with ${openChannels.length} channels. Sending START...`);
                // Primary channel for signaling
                const primary = this.advancedMode ? 
                    this.channels.find(c => c.label === 'fileTransfer_0') : 
                    this.dataChannel;
                
                if (primary && primary.readyState === 'open') {
                    primary.send(JSON.stringify({ type: 'start' }));
                }
            } else {
                console.log(`[Engine] Receiver waiting for channels... (${openChannels.length}/${expectedCount})`);
                setTimeout(checkAndStart, 200);
            }
        };
        checkAndStart();
    }

    async createOffer() {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        return offer;
    }

    async processCandidateQueue() {
        for (const candidate of this.candidateQueue) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.candidateQueue = [];
    }

    async handleOffer(offer) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        await this.processCandidateQueue();
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        return answer;
    }

    async handleAnswer(answer) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await this.processCandidateQueue();
    }

    async handleCandidate(candidate) {
        if (!this.peerConnection.remoteDescription) {
            this.candidateQueue.push(candidate);
        } else {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    getResumeOffset() {
        return this.advancedMode ? this.lastAckedOffset : this.receivedSize;
    }

    async resetConnection(iceServers) {
        console.log('[Engine] Resetting connection for resume...');
        this.channels.forEach(ch => { try { ch.close(); } catch(e){} });
        this.channels = [];
        if (this.dataChannel) { try { this.dataChannel.close(); } catch(e){} }
        if (this.peerConnection) { try { this.peerConnection.close(); } catch(e){} }
        this.peerConnection = null;
        this.dataChannel = null;
        this.candidateQueue = [];
        await this.init(iceServers);
    }
}

export default P2PTransfer;
