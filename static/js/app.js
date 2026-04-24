import P2PTransfer from './webrtc.js?v=2';

let room_id = null;
let cloud_id = null;
let role = 'sender'; 
let clientId = Math.random().toString(36).substring(2, 10);
let socket = null;
let p2p = null;
let currentFile = null;
let startTime = 0;
let handshakePromise = null;
let cachedIceServers = null;

let token = localStorage.getItem('ethershare_token');
let userEmail = localStorage.getItem('ethershare_email');

// UI View Elements
const views = {
    landing: document.getElementById('landing-view'),
    method: document.getElementById('method-view'),
    share: document.getElementById('share-view'),
    transfer: document.getElementById('transfer-view'),
    receive: document.getElementById('receive-view'),
    cloudReceive: document.getElementById('cloud-receive-view'),
    success: document.getElementById('success-view'),
    profile: document.getElementById('profile-view'),
    howItWorks: document.getElementById('how-it-works-view'),
    security: document.getElementById('security-view'),
};

const elements = {
    dropZone: document.getElementById('drop-zone'),
    selectBtn: document.getElementById('select-btn'),
    getStartedBtn: document.getElementById('get-started-btn'),
    shareUrl: document.getElementById('share-url'),
    copyBtn: document.getElementById('copy-btn'),
    fileNameLabel: document.getElementById('file-name-label'),
    fileInfoLabel: document.getElementById('file-info-label'),
    
    // Method Elements
    methodFileName: document.getElementById('method-file-name'),
    methodP2p: document.getElementById('method-p2p'),
    methodCloud: document.getElementById('method-cloud'),
    cloudLock: document.getElementById('cloud-lock'),
    
    transferFileName: document.getElementById('transfer-file-name'),
    transferFileInfo: document.getElementById('transfer-file-info'),
    progressPercent: document.getElementById('progress-percent'),
    progressBar: document.getElementById('progress-bar'),
    statusText: document.getElementById('status-text'),
    uploadedBytes: document.getElementById('uploaded-bytes'),

    rcvFileName: document.getElementById('rcv-file-name'),
    rcvFileInfo: document.getElementById('rcv-file-info'),
    acceptBtn: document.getElementById('accept-btn'),
    
    // Cloud Receive Elements
    cloudRcvFileName: document.getElementById('cloud-rcv-file-name'),
    cloudRcvFileInfo: document.getElementById('cloud-rcv-file-info'),
    cloudDownloadBtn: document.getElementById('cloud-download-btn'),
    
    successMsg: document.getElementById('success-msg'),
};

// Auth Elements
const auth = {
    modal: document.getElementById('auth-modal'),
    closeBtn: document.getElementById('close-auth-modal'),
    form: document.getElementById('auth-form'),
    email: document.getElementById('auth-email'),
    password: document.getElementById('auth-password'),
    submitBtn: document.getElementById('auth-submit'),
    toggleText: document.getElementById('auth-toggle-text'),
    toggleBtn: document.getElementById('auth-toggle-btn'),
    title: document.getElementById('auth-title'),
    
    unlogged: document.getElementById('auth-unlogged'),
    logged: document.getElementById('auth-logged'),
    emailDisplay: document.getElementById('user-email-display'),
    loginBtn: document.getElementById('login-btn'),
    registerBtn: document.getElementById('register-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    profileBtn: document.getElementById('profile-btn')
};

// Common Elements
const methodBackBtn = document.getElementById('method-back-btn');
const profileHomeBtn = document.getElementById('profile-home-btn');
const myfilesTbody = document.getElementById('myfiles-tbody');

let isLoginMode = true;

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.onchange = handleFileSelect;

function switchView(viewName) {
    Object.values(views).forEach(v => {
        if(v) v.classList.add('hidden');
    });
    if(views[viewName]) {
        views[viewName].classList.remove('hidden');
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function generateQRCode(text) {
    const qrDiv = document.getElementById('qrcode');
    if (!qrDiv) return;
    if (typeof QRCode === 'undefined') {
        console.error('QRCode library is not loaded.');
        return;
    }
    qrDiv.innerHTML = '';
    QRCode.toCanvas(text, { width: 160, margin: 2 }, (err, canvas) => {
        if (!err) qrDiv.appendChild(canvas);
    });
}

// ------ AUTHENTICATION LOGIC ------
const avatarBtn = document.getElementById('avatar-btn');
const profileDropdown = document.getElementById('profile-dropdown');
const avatarInitials = document.getElementById('avatar-initials');
const dropdownEmail = document.getElementById('dropdown-email');

function updateAuthUI() {
    if (token) {
        auth.unlogged.classList.add('hidden');
        auth.logged.classList.remove('hidden');
        auth.logged.classList.add('flex');
        auth.emailDisplay.innerText = userEmail;
        elements.cloudLock?.classList.add('hidden');
        // Set avatar initials
        if (avatarInitials && userEmail) {
            avatarInitials.innerText = userEmail[0].toUpperCase();
        }
        if (dropdownEmail) dropdownEmail.innerText = userEmail;
    } else {
        auth.unlogged.classList.remove('hidden');
        auth.logged.classList.add('hidden');
        auth.logged.classList.remove('flex');
        elements.cloudLock?.classList.remove('hidden');
        profileDropdown?.classList.remove('open');
    }
}

// Toggle dropdown on avatar click
avatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown?.classList.toggle('open');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (profileDropdown?.classList.contains('open')) {
        if (!avatarBtn?.contains(e.target) && !profileDropdown?.contains(e.target)) {
            profileDropdown.classList.remove('open');
        }
    }
});

// Close dropdown on any action inside
profileDropdown?.addEventListener('click', () => {
    profileDropdown.classList.remove('open');
});

function showAuthModal() {
    auth.modal.classList.remove('hidden');
}

function hideAuthModal() {
    auth.modal.classList.add('hidden');
    auth.form.reset();
}

function toggleAuthMode(e) {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    auth.title.innerText = isLoginMode ? 'Sign In' : 'Create Account';
    auth.submitBtn.innerText = isLoginMode ? 'Sign In' : 'Sign Up';
    auth.toggleText.innerText = isLoginMode ? "Don't have an account?" : "Already have an account?";
    auth.toggleBtn.innerText = isLoginMode ? "Sign Up" : "Sign In";
}

auth.loginBtn?.addEventListener('click', showAuthModal);
auth.registerBtn?.addEventListener('click', showAuthModal);
auth.closeBtn?.addEventListener('click', hideAuthModal);
auth.toggleBtn?.addEventListener('click', toggleAuthMode);
auth.logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('ethershare_token');
    localStorage.removeItem('ethershare_email');
    token = null;
    userEmail = null;
    updateAuthUI();
});

auth.form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
    
    // Both endpoints expect Form encoding
    const formData = new URLSearchParams();
    if(isLoginMode) formData.append('username', auth.email.value);
    else formData.append('email', auth.email.value);
    formData.append('password', auth.password.value);

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.detail || 'Auth failed');
        
        if (isLoginMode) {
            token = data.access_token;
            userEmail = data.email || auth.email.value;
            localStorage.setItem('ethershare_token', token);
            localStorage.setItem('ethershare_email', userEmail);
            updateAuthUI();
            hideAuthModal();
        } else {
            // Auto login after register
            isLoginMode = true;
            auth.submitBtn.click();
        }
    } catch (err) {
        alert(err.message);
    }
});
// ----------------------------------
// --- GLOBAL NAVIGATION ---
document.getElementById('nav-logo')?.addEventListener('click', () => switchView('landing'));
document.getElementById('nav-how')?.addEventListener('click', () => switchView('howItWorks'));
document.getElementById('nav-security')?.addEventListener('click', () => switchView('security'));
// ----------------------------------

async function handleFileSelect(e) {
    currentFile = e.target.files[0];
    if (currentFile) {
        elements.methodFileName.innerText = `${currentFile.name} (${formatBytes(currentFile.size)})`;
        switchView('method');
    }
}

methodBackBtn?.addEventListener('click', () => {
    currentFile = null;
    fileInput.value = '';
    switchView('landing');
});

profileHomeBtn?.addEventListener('click', () => {
    switchView('landing');
});

auth.profileBtn?.addEventListener('click', () => {
    switchView('profile');
    fetchMyFiles();
    showProfileTab('files');
});

// ---- PROFILE TABS ----
function showProfileTab(tab) {
    const filesTab = document.getElementById('tab-files');
    const settingsTab = document.getElementById('tab-settings');
    const fileBtn = document.getElementById('tab-files-btn');
    const settingsBtn = document.getElementById('tab-settings-btn');

    if (tab === 'files') {
        filesTab?.classList.remove('hidden');
        settingsTab?.classList.add('hidden');
        fileBtn?.classList.add('bg-surface-container-high', 'text-on-surface');
        fileBtn?.classList.remove('text-on-surface-variant');
        settingsBtn?.classList.remove('bg-surface-container-high', 'text-on-surface');
        settingsBtn?.classList.add('text-on-surface-variant');
    } else {
        filesTab?.classList.add('hidden');
        settingsTab?.classList.remove('hidden');
        settingsBtn?.classList.add('bg-surface-container-high', 'text-on-surface');
        settingsBtn?.classList.remove('text-on-surface-variant');
        fileBtn?.classList.remove('bg-surface-container-high', 'text-on-surface');
        fileBtn?.classList.add('text-on-surface-variant');
        initAdvancedToggleUI();
    }
}

document.getElementById('tab-files-btn')?.addEventListener('click', () => showProfileTab('files'));
document.getElementById('tab-settings-btn')?.addEventListener('click', () => showProfileTab('settings'));

// ---- CHANGE PASSWORD ----
document.getElementById('change-password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cpCurrent = document.getElementById('cp-current').value;
    const cpNew = document.getElementById('cp-new').value;
    const cpConfirm = document.getElementById('cp-confirm').value;
    const cpMsg = document.getElementById('cp-msg');

    if (cpNew !== cpConfirm) {
        cpMsg.innerText = '⚠ Passwords do not match.';
        cpMsg.style.color = '#f87171';
        return;
    }
    try {
        const formData = new URLSearchParams();
        formData.append('current_password', cpCurrent);
        formData.append('new_password', cpNew);
        const res = await fetch('/auth/change-password', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail);
        cpMsg.innerText = '✓ ' + data.message;
        cpMsg.style.color = '#86efac';
        document.getElementById('change-password-form').reset();
    } catch (err) {
        cpMsg.innerText = '✗ ' + err.message;
        cpMsg.style.color = '#f87171';
    }
});

// ---- ADVANCED TRANSFER TOGGLE ----
let advancedTransferMode = localStorage.getItem('advanced_transfer') === 'true';

function initAdvancedToggleUI() {
    const btn = document.getElementById('advanced-transfer-toggle');
    const knob = document.getElementById('advanced-toggle-knob');
    const statusEl = document.getElementById('advanced-mode-status');
    const features = document.querySelectorAll('.setting-feature');

    function applyToggleState(isOn) {
        if (isOn) {
            btn?.setAttribute('aria-pressed', 'true');
            btn?.classList.add('bg-primary/20', 'border-primary/30');
            btn?.classList.remove('bg-surface-container-highest');
            knob?.classList.add('translate-x-7', 'bg-primary');
            knob?.classList.remove('bg-on-surface-variant');
            features.forEach(f => {
                f.classList.remove('opacity-50');
                f.querySelector('.check-icon').innerText = 'check_circle';
                f.querySelector('.check-icon').style.color = '#a4e6ff';
            });
            if (statusEl) { statusEl.innerText = 'Enabled'; statusEl.style.color = '#a4e6ff'; }
        } else {
            btn?.setAttribute('aria-pressed', 'false');
            btn?.classList.remove('bg-primary/20', 'border-primary/30');
            btn?.classList.add('bg-surface-container-highest');
            knob?.classList.remove('translate-x-7', 'bg-primary');
            knob?.classList.add('bg-on-surface-variant');
            features.forEach(f => {
                f.classList.add('opacity-50');
                f.querySelector('.check-icon').innerText = 'radio_button_unchecked';
                f.querySelector('.check-icon').style.color = '';
            });
            if (statusEl) { statusEl.innerText = 'Disabled'; statusEl.style.color = ''; }
        }
    }

    applyToggleState(advancedTransferMode);

    btn?.addEventListener('click', () => {
        advancedTransferMode = !advancedTransferMode;
        localStorage.setItem('advanced_transfer', advancedTransferMode);
        applyToggleState(advancedTransferMode);
    });
}

async function fetchMyFiles() {
    if (!token) return;
    myfilesTbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center">Loading...</td></tr>';
    try {
        const res = await fetch('/cloud/myfiles', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch files");
        const files = await res.json();
        
        myfilesTbody.innerHTML = '';
        if (files.length === 0) {
            myfilesTbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-on-surface-variant italic">No active cloud uploads found.</td></tr>';
            return;
        }
        
        files.forEach(f => {
            const expDate = new Date(f.expires_at);
            const now = new Date();
            const diffHours = Math.max(0, Math.floor((expDate - now) / (1000 * 60 * 60)));
            const diffMins = Math.max(0, Math.floor(((expDate - now) % (1000 * 60 * 60)) / (1000 * 60)));
            
            const linkUrl = `${window.location.origin}/download/${f.id}`;
            const timeText = diffHours > 0 ? `${diffHours}h ${diffMins}m` : `${diffMins}m`;

            const tr = document.createElement('tr');
            tr.className = "hover:bg-surface-container-high transition-colors";
            tr.innerHTML = `
                <td class="py-4 px-6 font-semibold">${f.filename}</td>
                <td class="py-4 px-6">${formatBytes(f.size_bytes)}</td>
                <td class="py-4 px-6 text-primary">${timeText}</td>
                <td class="py-4 px-6"><button onclick="copyCloudLink('${linkUrl}', this)" class="flex items-center gap-1.5 text-secondary font-semibold text-sm hover:text-primary transition-colors"><span class="material-symbols-outlined" style="font-size:16px;">content_copy</span><span>Copy Link</span></button></td>
                <td class="py-4 px-6 text-center">
                    <button onclick="deleteCloudFile('${f.id}')" class="text-on-surface-variant hover:text-red-400 transition-colors material-symbols-outlined" title="Delete">delete</button>
                </td>
            `;
            myfilesTbody.appendChild(tr);
        });
    } catch (err) {
        myfilesTbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-400">Error loading files</td></tr>`;
    }
}

window.deleteCloudFile = async (id) => {
    if (!confirm("Are you sure you want to delete this file? The sharing link will immediately break.")) return;
    
    try {
        const res = await fetch(`/cloud/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            fetchMyFiles(); // Refresh
        } else {
            alert("Failed to delete file");
        }
    } catch (err) {
        alert("Error connecting to server");
    }
};

window.copyCloudLink = (url, btn) => {
    navigator.clipboard.writeText(url).then(() => {
        const span = btn.querySelector('span:last-child');
        const icon = btn.querySelector('.material-symbols-outlined');
        const originalText = span.innerText;
        const originalIcon = icon.innerText;
        span.innerText = 'Copied!';
        icon.innerText = 'check_circle';
        btn.classList.add('text-primary');
        btn.classList.remove('text-secondary');
        setTimeout(() => {
            span.innerText = originalText;
            icon.innerText = originalIcon;
            btn.classList.remove('text-primary');
            btn.classList.add('text-secondary');
        }, 2000);
    }).catch(() => {
        alert('Could not copy. Please copy manually:\n' + url);
    });
};

// ------ SHARING METHOD LOGIC ------
elements.methodP2p?.addEventListener('click', async () => {
    try {
        const metadata = {
            name: currentFile.name,
            size: currentFile.size,
            mime: currentFile.type || 'application/octet-stream'
        };

        const res = await fetch('/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ advanced: advancedTransferMode, metadata })
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.detail || "Failed to create room");
        
        room_id = data.room_id;
        
        elements.fileNameLabel.innerText = currentFile.name;
        elements.fileInfoLabel.innerText = `${formatBytes(currentFile.size)} • ${currentFile.type || 'Unknown Type'}`;
        
        await setupSignaling(room_id);
        
        const url = `${window.location.origin}/live/${room_id}`;
        elements.shareUrl.innerText = url;
        generateQRCode(url);
        switchView('share');
    } catch (err) {
        console.error("P2P creation failed:", err);
        elements.methodFileName.innerText = "Connection failed";
        elements.methodFileName.style.color = "red";
    }
});

elements.methodCloud?.addEventListener('click', async () => {
    if (!token) {
        showAuthModal();
        return;
    }
    
    // Check 500MB limit securely
    const MAX_MB = 500;
    if (currentFile.size > MAX_MB * 1024 * 1024) {
        alert(`File limit exceeded! 24-Hour Cloud Store only supports files up to ${MAX_MB}MB. Please use 'Live Peer-to-Peer' for larger files.`);
        return;
    }
    
    // Switch directly to transfer view to show progress
    elements.transferFileName.innerText = currentFile.name;
    elements.transferFileInfo.innerText = formatBytes(currentFile.size);
    elements.statusText.innerText = "Uploading to Cloud...";
    switchView('transfer');
    
    // XMLHttpRequest for progress events
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", currentFile);
    
    xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            updateProgress(percent);
        }
    };
    
    xhr.onload = () => {
        if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            const url = `${window.location.origin}/download/${data.cloud_id}`;
            
            elements.fileNameLabel.innerText = currentFile.name;
            elements.fileInfoLabel.innerText = "Valid for 24 Hours";
            
            elements.shareUrl.innerText = url;
            generateQRCode(url);
            switchView('share');
        } else {
            alert('Upload failed: ' + xhr.responseText);
            switchView('method');
        }
    };
    
    xhr.onerror = () => {
        alert('Network Error during upload');
        switchView('method');
    };
    
    xhr.open("POST", "/cloud/upload");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
});
// ----------------------------------

async function setupSignaling(id) {
    console.log('Signaling: Socket.io started');
    
    if (!socket) {
        socket = io({ reconnectionAttempts: 3, timeout: 10000 });
        
        socket.on('connect', () => {
            console.log("Socket connected");
            if (elements.statusText) elements.statusText.innerText = "Waiting for peer...";
            socket.emit('join_room', { room_id: id, client_id: clientId });
        });

        socket.on('disconnect', () => {
            console.log("Socket disconnected");
            if (elements.statusText) elements.statusText.innerText = "Reconnecting...";
            if (role === 'receiver' && elements.rcvFileInfo) {
                elements.rcvFileInfo.innerText = "Disconnected from server. Reconnecting...";
            }
        });
        
        socket.on('peer_disconnected', () => {
            console.log("Peer disconnected");
            if (elements.statusText) elements.statusText.innerText = "Sender disconnected. Waiting...";
            if (role === 'receiver' && elements.rcvFileInfo) {
                elements.rcvFileInfo.innerText = "Sender disconnected.";
            }
        });

        socket.on('signal', async (msg) => {
            if (msg.sender_id === clientId && msg.type !== 'ready') return;
            await handleSignalMessage(msg);
        });
    } else {
        socket.emit('join_room', { room_id: id, client_id: clientId });
    }
}

async function sendSignalMsg(msg) {
    if (!room_id || !socket || !socket.connected) return;
    socket.emit('signal', {...msg, sender_id: clientId, room_id: room_id});
}

async function handleSignalMessage(data) {
    switch (data.type) {
        case 'ready':
            if (data.advanced !== undefined) {
                advancedTransferMode = data.advanced;
            }
            if (role === 'receiver' && data.metadata) {
                onMetadataReceived(data.metadata);
            }
            await startHandshake();
            if (role === 'sender') {
                if (currentFile) p2p.startTransfer(currentFile);
                const offer = await p2p.createOffer();
                sendSignalMsg({ type: 'offer', offer });
            }
            break;
        case 'offer':
            await startHandshake();
            const answer = await p2p.handleOffer(data.offer);
            sendSignalMsg({ type: 'answer', answer });
            break;
        case 'answer':
            await startHandshake();
            await p2p.handleAnswer(data.answer);
            break;
        case 'candidate':
            await startHandshake();
            await p2p.handleCandidate(data.candidate);
            break;
        case 'start':
            if (role === 'sender') {
                startTransferUI(0);
            }
            break;
        case 'resume':
            if (role === 'sender') {
                startTransferUI(data.offset || 0);
            }
            break;
    }
}

function onMetadataReceived(data) {
    if (p2p && p2p.receivedSize > 0 && p2p.fileName === data.name) {
        console.log('Auto-resuming transfer...');
        if (elements.statusText) elements.statusText.innerText = "Resuming transfer...";
        sendSignalMsg({ type: 'resume', offset: p2p.receivedSize });
        return;
    }
    elements.rcvFileName.innerText = data.name;
    elements.rcvFileInfo.innerText = `Size: ${formatBytes(data.size)} • ${data.mime}`;
    if (elements.acceptBtn) elements.acceptBtn.style.display = 'inline-block';
}

function startTransferUI(offset = 0) {
    switchView('transfer');
    elements.transferFileName.innerText = currentFile ? currentFile.name : elements.rcvFileName.innerText;
    elements.transferFileInfo.innerText = currentFile ? formatBytes(currentFile.size) : elements.rcvFileInfo.innerText;
    if (elements.statusText) elements.statusText.innerText = "Transferring P2P...";
    startTime = Date.now();
    p2p.sendChunks(offset);
}

async function startHandshake() {
    if (handshakePromise) return handshakePromise;
    handshakePromise = (async () => {
        p2p = new P2PTransfer(role, updateProgress, onTransferComplete, onTransferError, onMetadataReceived, advancedTransferMode);
        p2p.onSignal = (msg) => {
            sendSignalMsg(msg);
        };

        if (!cachedIceServers) {
            try {
                const configRes = await fetch('/config/ice_servers.json');
                cachedIceServers = await configRes.json();
            } catch(e) {
                cachedIceServers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
            }
        }
        await p2p.init(cachedIceServers);
    })();
    return handshakePromise;
}

function updateProgress(percent) {
    elements.progressBar.style.width = `${percent}%`;
    elements.progressPercent.innerHTML = `${percent}<span class="text-2xl text-primary">%</span>`;
    
    if (currentFile) {
        const uploaded = (percent / 100) * currentFile.size;
        elements.uploadedBytes.innerText = formatBytes(uploaded);
    }
}

function onTransferComplete(blob, name) {
    if (role === 'receiver') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        elements.successMsg.innerText = `"${name}" has safely reached the destination.`;
        
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
            downloadBtn.style.display = 'inline-block';
            downloadBtn.onclick = () => {
                const dlUrl = URL.createObjectURL(blob);
                const dlA = document.createElement('a');
                dlA.href = dlUrl;
                dlA.download = name;
                dlA.click();
                URL.revokeObjectURL(dlUrl);
            };
        }
    } else {
        elements.successMsg.innerText = `"${currentFile.name}" has been successfully transmitted.`;
    }
    switchView('success');
}

let reconnectLock = false;

async function autoReconnectWebRTC() {
    if (reconnectLock) return;
    reconnectLock = true;
    if (elements.statusText) elements.statusText.innerText = "Connection lost. Resuming...";
    
    // Check if socket is disconnected, try to reconnect it
    if (socket && !socket.connected) {
        socket.connect();
    }
    
    handshakePromise = null; // Allow fresh handshake
    try {
        if (!cachedIceServers) {
            const configRes = await fetch('/config/ice_servers.json');
            cachedIceServers = await configRes.json();
        }
        if (p2p) {
            await p2p.resetConnection(cachedIceServers);
            p2p.onSignal = (msg) => { sendSignalMsg(msg); };
        }
        if (role === 'sender' && currentFile) {
            p2p.startTransfer(currentFile);
            const offer = await p2p.createOffer();
            sendSignalMsg({ type: 'offer', offer });
        } else if (role === 'receiver') {
             // Let sender know we are ready to resume
             if (p2p && p2p.receivedSize > 0) {
                 sendSignalMsg({ type: 'resume', offset: p2p.receivedSize });
             }
        }
    } catch (err) {
        console.error("Resume failed:", err);
        if (elements.statusText) elements.statusText.innerText = "Failed to resume transfer.";
    } finally {
        setTimeout(() => { reconnectLock = false; }, 5000); // Allow retry after 5s
    }
}

function onTransferError(err) {
    console.error('P2P Error:', err);
    if (elements.statusText) elements.statusText.innerText = "Transfer failed, retrying...";
    autoReconnectWebRTC();
}

// Event Listeners
elements.selectBtn?.addEventListener('click', () => fileInput.click());
elements.getStartedBtn?.addEventListener('click', () => fileInput.click());

elements.dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.style.borderColor = 'rgba(0, 209, 255, 0.5)';
});
elements.dropZone?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    elements.dropZone.style.borderColor = 'rgba(60, 73, 78, 0.15)';
});
elements.dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.style.borderColor = 'rgba(60, 73, 78, 0.15)';
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect({ target: { files: e.dataTransfer.files } });
    }
});

elements.copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.shareUrl.innerText).then(() => {
        const originalContent = elements.copyBtn.innerHTML;
        elements.copyBtn.innerHTML = '<span style="color: #00d1ff">Copied!</span>';
        setTimeout(() => { elements.copyBtn.innerHTML = originalContent; }, 2000);
    }).catch(err => console.error('Failed to copy', err));
});
elements.acceptBtn?.addEventListener('click', () => {
    sendSignalMsg({ type: 'start' });
    switchView('transfer');
    elements.transferFileName.innerText = elements.rcvFileName.innerText;
    elements.transferFileInfo.innerText = elements.rcvFileInfo.innerText;
});

// ------ INITIALIZATION ------
window.onload = async () => {
    updateAuthUI();
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    let roomParam = params.get('room');
    if (!roomParam && path.startsWith('/live/')) {
        const parts = path.split('/');
        roomParam = parts[parts.length - 1];
    }

    let cloudParam = params.get('cloud');
    if (!cloudParam && path.startsWith('/download/')) {
        const parts = path.split('/');
        cloudParam = parts[parts.length - 1];
    }
    
    if (roomParam) {
        room_id = roomParam;
        role = 'receiver';
        setupSignaling(room_id);
        switchView('receive');
    } else if (cloudParam) {
        role = 'receiver';
        await fetchCloudMetadata(cloudParam);
    } else {
        switchView('landing');
    }
};

async function fetchCloudMetadata(cloud_id) {
    switchView('cloudReceive');
    try {
        const res = await fetch(`/cloud/metadata/${cloud_id}`);
        if (!res.ok) throw new Error("File expired or not found");
        const data = await res.json();
        elements.cloudRcvFileName.innerText = data.filename;
        elements.cloudRcvFileInfo.innerText = `Size: ${formatBytes(data.size)} • ${data.mime}`;
        
        elements.cloudDownloadBtn.onclick = () => {
            // Backend returns a 302 redirect to Cloudinary signed URL
            // with fl_attachment flag — browser will auto-download the file
            window.location.href = `/cloud/download/${cloud_id}`;
        };
    } catch (err) {
        elements.cloudRcvFileName.innerText = "Link Expired";
        elements.cloudRcvFileInfo.innerText = "This file was deleted or never existed.";
        elements.cloudDownloadBtn.style.display = 'none';
        elements.cloudRcvFileName.style.color = "red";
    }
}
