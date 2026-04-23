const API_BASE = '/api';

let players = [];
let attendances = new Set();
let cores = new Set();
let allocatedQuarters = { 1: [], 2: [], 3: [], 4: [] };
let quarterFormations = { 1: '4231', 2: '4231', 3: '4231', 4: '4231' };
let quarterMemos = { 1: '', 2: '', 3: '', 4: '' };
let quarterPositions = { 1: {}, 2: {}, 3: {}, 4: {} }; // pid -> {x, y}
let currentQuarter = 1;
let editingPlayerId = null;
let swapSource = null; // {pid, q, type: 'pitch'|'bench'}
let confirmedQuarters = new Set();
let isMatchSaved = false;

function updateAttendanceCounter() {
    const el = document.getElementById('attendanceCounter');
    if (el) el.innerText = `현재 ${attendances.size}명 선택됨`;
}

// Persistence logic
function saveToLocal() {
    localStorage.setItem('lineup_attendances', JSON.stringify(Array.from(attendances)));
    localStorage.setItem('lineup_cores', JSON.stringify(Array.from(cores)));
}

function loadFromLocal() {
    const savedAtt = localStorage.getItem('lineup_attendances');
    const savedCores = localStorage.getItem('lineup_cores');
    if (savedAtt) {
        try {
            JSON.parse(savedAtt).forEach(id => { if(id) attendances.add(Number(id)); });
        } catch(e) {}
    }
    if (savedCores) {
        try {
            JSON.parse(savedCores).forEach(id => { if(id) cores.add(Number(id)); });
        } catch(e) {}
    }
}

loadFromLocal();

// Formation templates
const formationTemplates = {
    '433': [ {role: 'FW', x: 50, y: 15}, {role: 'WF', x: 25, y: 20}, {role: 'WF', x: 75, y: 20}, {role: 'CM', x: 35, y: 45}, {role: 'CM', x: 65, y: 45}, {role: 'CDM', x: 50, y: 60}, {role: 'CB', x: 35, y: 80}, {role: 'CB', x: 65, y: 80}, {role: 'WB', x: 15, y: 75}, {role: 'WB', x: 85, y: 75}, {role: 'GK', x: 50, y: 92} ],
    '4231': [ {role: 'FW', x: 50, y: 15}, {role: 'CAM', x: 50, y: 30}, {role: 'WF', x: 20, y: 35}, {role: 'WF', x: 80, y: 35}, {role: 'CDM', x: 35, y: 55}, {role: 'CDM', x: 65, y: 55}, {role: 'CB', x: 35, y: 80}, {role: 'CB', x: 65, y: 80}, {role: 'WB', x: 15, y: 75}, {role: 'WB', x: 85, y: 75}, {role: 'GK', x: 50, y: 92} ],
    '352': [ {role: 'FW', x: 40, y: 15}, {role: 'FW', x: 60, y: 15}, {role: 'CAM', x: 50, y: 35}, {role: 'CM', x: 35, y: 45}, {role: 'CM', x: 65, y: 45}, {role: 'WB', x: 15, y: 55}, {role: 'WB', x: 85, y: 55}, {role: 'CB', x: 30, y: 80}, {role: 'CB', x: 50, y: 80}, {role: 'CB', x: 70, y: 80}, {role: 'GK', x: 50, y: 92} ],
    '442': [ {role: 'FW', x: 35, y: 15}, {role: 'FW', x: 65, y: 15}, {role: 'WF', x: 20, y: 45}, {role: 'WF', x: 80, y: 45}, {role: 'CM', x: 40, y: 45}, {role: 'CM', x: 60, y: 45}, {role: 'CB', x: 35, y: 80}, {role: 'CB', x: 65, y: 80}, {role: 'WB', x: 15, y: 75}, {role: 'WB', x: 85, y: 75}, {role: 'GK', x: 50, y: 92} ]
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('matchDate').value = new Date().toISOString().split('T')[0];
    initTabs();
    fetchPlayers();
    fetchMatches();
    
    document.getElementById('addPlayerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const p = {
            name: document.getElementById('pName').value,
            pos1: document.getElementById('pPos1').value,
            pos2: document.getElementById('pPos2').value,
            is_core: 0,
            back_number: document.getElementById('pBackNumber').value
        };
        if (editingPlayerId) {
            await fetch(`${API_BASE}/players/${editingPlayerId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(p)
            });
            editingPlayerId = null;
            document.querySelector('#addPlayerForm button[type="submit"]').innerText = '추가하기';
        } else {
            await fetch(`${API_BASE}/players`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(p)
            });
        }
        document.getElementById('addPlayerForm').reset();
        fetchPlayers();
    });

    document.getElementById('btnDistribute').addEventListener('click', async () => {
        if(attendances.size === 0) return alert('참석자를 1명 이상 선택하세요.');
        for(let q=1; q<=4; q++) {
            quarterFormations[q] = document.getElementById(`preForm${q}`).value;
        }
        const res = await fetch(`${API_BASE}/distribute`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ attendance_ids: Array.from(attendances), core_ids: Array.from(cores) })
        });
        const rawResult = await res.json();
        // JSON 키는 항상 문자열로 오므로 숫자 키로 변환
        allocatedQuarters = { 1: [], 2: [], 3: [], 4: [] };
        for (const [key, val] of Object.entries(rawResult)) {
            allocatedQuarters[Number(key)] = val.map(id => Number(id));
        }
        quarterPositions = { 1: {}, 2: {}, 3: {}, 4: {} }; 
        confirmedQuarters.clear();
        isMatchSaved = false;
        autoPlaceAllQuarters();
        document.querySelector('[data-target="boardView"]').click();
        renderAllQuarters();
    });

    document.getElementById('btnSaveImage').addEventListener('click', async () => {
        const target = document.getElementById('captureArea');
        try {
            const canvas = await html2canvas(target, { backgroundColor: '#0f172a', scale: 2 });
            const dataUrl = canvas.toDataURL("image/png");
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `All_Quarters_Lineup.png`;
            a.click();
        } catch(e) {
            console.error('Image capture err:', e);
            alert('이미지 저장에 실패했습니다.');
        }
    });

    document.getElementById('btnSaveData').addEventListener('click', async () => {
        const opponent = document.getElementById('matchOpponent').value.trim();
        const dateStr = document.getElementById('matchDate').value || new Date().toISOString().split('T')[0];
        const mName = opponent || '자체전';
        
        if(confirmedQuarters.size === 0) return alert('확정된 쿼터가 없습니다. 각 쿼터별 [확정] 버튼을 눌러주세요.');

        // Only include allocations for confirmed quarters for statistics
        const filteredAllocations = {};
        confirmedQuarters.forEach(q => {
            filteredAllocations[q] = allocatedQuarters[q];
        });

        const payload = {
            name: mName,
            date_str: dateStr,
            opponent: opponent,
            lineup_data: {
                formations: quarterFormations,
                memos: quarterMemos,
                allocations: filteredAllocations, 
                positions: quarterPositions,
                confirmed: Array.from(confirmedQuarters)
            }
        };
        await fetch(`${API_BASE}/matches`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        isMatchSaved = true;
        alert('저장 완료! (확정된 쿼터의 기록이 통계에 반영되었습니다)');
        fetchMatches();
    });
});

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.add('active');
            if (e.target.dataset.target === 'boardView') {
                renderAllQuarters();
            } else if (e.target.dataset.target === 'statsView') {
                fetchStats();
            }
        });
    });
}

async function fetchPlayers() {
    const res = await fetch(`${API_BASE}/players`);
    players = await res.json();
    renderPlayerList();
    updateAttendanceCounter();
}

async function fetchMatches() {
    const res = await fetch(`${API_BASE}/matches`);
    const history = await res.json();
    const ul = document.getElementById('historyList');
    ul.innerHTML = history.map(h => `
        <li style="flex-direction: column; gap: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${h.date_str} vs ${h.opponent || '자체전'}</strong>
                <select class="match-result-select" data-id="${h.id}" style="width:auto; margin-bottom:0; padding:4px 8px;">
                    <option value="" ${!h.result ? 'selected' : ''}>결과 선택</option>
                    <option value="승" ${h.result === '승' ? 'selected' : ''}>승리</option>
                    <option value="무" ${h.result === '무' ? 'selected' : ''}>무승부</option>
                    <option value="패" ${h.result === '패' ? 'selected' : ''}>패배</option>
                </select>
            </div>
            <div style="display:flex; gap:10px;">
                <input type="text" class="match-memo-input" data-id="${h.id}" value="${h.memo || ''}" placeholder="경기 메모 (예: 폭우, 부상자 다수)" style="margin-bottom:0;">
                <button class="btn-primary btn-save-memo" data-id="${h.id}" style="width:auto; padding: 0 15px; white-space:nowrap;">저장</button>
            </div>
        </li>
    `).join('');

    document.querySelectorAll('.btn-save-memo').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const matchId = e.target.dataset.id;
            const li = e.target.closest('li');
            const result = li.querySelector('.match-result-select').value;
            const memo = li.querySelector('.match-memo-input').value;

            await fetch(`${API_BASE}/matches/${matchId}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ result, memo })
            });
            alert('기록이 저장되었습니다.');
        });
    });
}

function renderPlayerList() {
    const ul = document.getElementById('playerList');
    ul.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-item';
        li.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="display:flex; flex-direction:column; gap:3px;">
                    <span class="p-name">${p.name}</span>
                    <span class="p-pos">${p.pos1} ${p.pos2!=='none'? '/ '+p.pos2:''}</span>
                    <span class="p-tags">No.${p.back_number || '?'}</span>
                </div>
                <button class="btn-edit" data-id="${p.id}" style="background:transparent; border:none; padding:2px; font-size:1.1rem; cursor:pointer;" title="정보 수정">✏️</button>
            </div>
            <div class="p-actions">
                <label class="chk-label"><input type="checkbox" data-id="${p.id}" class="chk-attend" ${attendances.has(p.id) ? 'checked' : ''}> ✓참석</label>
                <label class="chk-label"><input type="checkbox" data-id="${p.id}" class="chk-core" ${cores.has(p.id) ? 'checked' : ''}> ★핵심</label>
            </div>
        `;
        const chkAttend = li.querySelector('.chk-attend');
        const chkCore = li.querySelector('.chk-core');
        const btnEdit = li.querySelector('.btn-edit');
        
        btnEdit.addEventListener('click', () => {
            document.getElementById('pName').value = p.name;
            document.getElementById('pPos1').value = p.pos1;
            document.getElementById('pPos2').value = p.pos2 || 'none';
            document.getElementById('pBackNumber').value = p.back_number || '';
            editingPlayerId = p.id;
            document.querySelector('#addPlayerForm button[type="submit"]').innerText = '수정하기';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        
        chkAttend.addEventListener('change', (e) => {
            if(e.target.checked) attendances.add(p.id);
            else { attendances.delete(p.id); chkCore.checked=false; cores.delete(p.id); }
            saveToLocal();
            updateAttendanceCounter();
        });
        
        chkCore.addEventListener('change', (e) => {
            if(e.target.checked) { cores.add(p.id); chkAttend.checked=true; attendances.add(p.id); }
            else cores.delete(p.id);
            saveToLocal();
            updateAttendanceCounter();
        });
        
        ul.appendChild(li);
    });
}

// ---------------- Board Logic ----------------

function autoPlaceAllQuarters() {
    for(let q=1; q<=4; q++) {
        let form = formationTemplates[quarterFormations[q]];
        let qPlayers = allocatedQuarters[q] ? allocatedQuarters[q].slice() : [];
        if (qPlayers.length === 0) continue;
        
        let assignments = {}; // pid -> pos
        let remainingPlayers = qPlayers.slice();
        let remainingSpots = form.map((s, i) => ({...s, id: i}));

        // 1-Pass: Exact 1st choice match
        for (let i = remainingSpots.length - 1; i >= 0; i--) {
            let spot = remainingSpots[i];
            let matchedIdx = remainingPlayers.findIndex(pid => {
                let p = players.find(x => x.id === pid);
                return p && p.pos1 === spot.role;
            });
            if (matchedIdx !== -1) {
                let pid = remainingPlayers.splice(matchedIdx, 1)[0];
                assignments[pid] = { x: spot.x, y: spot.y };
                remainingSpots.splice(i, 1);
            }
        }

        // 2-Pass: 2nd choice match
        for (let i = remainingSpots.length - 1; i >= 0; i--) {
            let spot = remainingSpots[i];
            let matchedIdx = remainingPlayers.findIndex(pid => {
                let p = players.find(x => x.id === pid);
                return p && p.pos2 === spot.role;
            });
            if (matchedIdx !== -1) {
                let pid = remainingPlayers.splice(matchedIdx, 1)[0];
                assignments[pid] = { x: spot.x, y: spot.y };
                remainingSpots.splice(i, 1);
            }
        }

        // 3-Pass: Fill leftovers
        remainingSpots.forEach(spot => {
            if (remainingPlayers.length > 0) {
                let pid = remainingPlayers.shift();
                assignments[pid] = { x: spot.x, y: spot.y };
            }
        });

        // Update global positions (Object.keys returns strings, convert to Number)
        Object.keys(assignments).forEach(pid => {
            quarterPositions[q][Number(pid)] = assignments[pid];
        });
        
        remainingPlayers.forEach(pid => {
            quarterPositions[q][Number(pid)] = { x: -1, y: -1 }; 
        });
    }
}

function renderAllQuarters() {
    const grid = document.getElementById('captureArea');
    grid.innerHTML = '';
    
    // 마스터 리스트 (오늘의 출전 명단) 렌더링
    const masterList = document.getElementById('masterList');
    masterList.innerHTML = '';
    
    // 각 선수의 출전 쿼터 계산
    let attendingPlayers = Array.from(attendances).map(id => players.find(p=>p.id===id)).filter(p=>p);
    let playerQData = attendingPlayers.map(p => {
        let qs = [];
        for(let q=1; q<=4; q++) {
            if(allocatedQuarters[q] && allocatedQuarters[q].map(id=>Number(id)).includes(Number(p.id))) qs.push(q);
        }
        return { player: p, qs };
    });

    // 쿼터 수 많은 순 → 쿼터 번호 오름차순으로 정렬
    playerQData.sort((a, b) => {
        if (b.qs.length !== a.qs.length) return b.qs.length - a.qs.length;
        return (a.qs[0] || 99) - (b.qs[0] || 99);
    });

    // 쿼터 배지 색상
    const qColors = { 1: '#3b82f6', 2: '#10b981', 3: '#f59e0b', 4: '#ef4444' };
    const qCountLabel = { 4: '4Q', 3: '3Q', 2: '2Q', 1: '1Q', 0: '휴식' };

    playerQData.forEach(({ player: p, qs }) => {
        const qBadges = qs.map(q =>
            `<span style="background:${qColors[q]}; color:#fff; padding:2px 7px; border-radius:10px; font-size:0.75rem; font-weight:700;">${q}Q</span>`
        ).join(' ');

        const countLabel = qCountLabel[qs.length] || '휴식';
        const countColor = qs.length === 4 ? '#ef4444' : qs.length === 3 ? '#f59e0b' : qs.length === 2 ? '#10b981' : qs.length === 1 ? '#3b82f6' : '#64748b';

        masterList.innerHTML += `<div style="background:rgba(255,255,255,0.08); padding:6px 12px; border-radius:15px; font-size:0.85rem; display:flex; align-items:center; gap:8px; border-left: 3px solid ${countColor};">
            <span style="font-weight:700; color:${countColor}; min-width:26px; font-size:0.8rem;">${countLabel}</span>
            <strong style="min-width:60px;">${p.name}</strong>
            <span style="display:flex; gap:4px; flex-wrap:wrap;">${qs.length > 0 ? qBadges : '<span style="color:#64748b; font-size:0.75rem;">휴식</span>'}</span>
        </div>`;
    });
    
    for(let q=1; q<=4; q++) {
        let wrapper = document.createElement('div');
        wrapper.className = 'quarter-wrapper';
        if (confirmedQuarters.has(q)) wrapper.classList.add('confirmed');
        wrapper.id = `qw${q}`;
        
        let formatOpts = Object.keys(formationTemplates).map(f => `<option value="${f}" ${quarterFormations[q]===f?'selected':''}>${f}</option>`).join('');
        
        let pitchHtml = `
            <div class="q-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <h3 style="margin:0; font-size:1.1rem;">${q}쿼터</h3>
                    <button class="btn-confirm-q" data-q="${q}" style="padding:2px 8px; font-size:0.7rem; background:${confirmedQuarters.has(q)?'#166534':'#475569'}; border:none; border-radius:4px; color:white; cursor:pointer;">
                        ${confirmedQuarters.has(q)?'✅ 확정됨':'확정하기'}
                    </button>
                </div>
                <select class="q-form-select" data-q="${q}">${formatOpts}</select>
            </div>
            <input type="text" class="q-memo" data-q="${q}" value="${quarterMemos[q] || ''}" placeholder="전술 메모 (예: 강한 압박)">
            <div class="pitch-container" id="pitch-container-${q}">
                <div class="pitch-memo" id="pitchMemoDisplay-${q}">${quarterMemos[q] ? 'Q'+q+': '+quarterMemos[q] : ''}</div>
                <div class="pitch">
                    <div class="pitch-center-circle"></div>
                    <div class="pitch-center-line"></div>
                    <div class="pitch-box-top"></div>
                    <div class="pitch-box-bottom"></div>
                    <div id="formationSpots-${q}" style="width:100%; height:100%; position:absolute; top:0; left:0;"></div>
                </div>
            </div>
            <div class="unassigned-panel">
                <h4 style="margin-bottom:8px; font-size:0.9rem; color:var(--text-secondary);">해당 쿼터 대기 명단</h4>
                <div id="benchArea-${q}" class="bench-area"></div>
            </div>
        `;
        wrapper.innerHTML = pitchHtml;
        grid.appendChild(wrapper);
        
        wrapper.querySelector('.q-form-select').addEventListener('change', (e) => {
            quarterFormations[q] = e.target.value;
            let pf = document.getElementById(`preForm${q}`);
            if (pf) pf.value = e.target.value;
            quarterPositions[q] = {}; // Reset positions
            isMatchSaved = false;
            autoPlaceAllQuarters();
            renderAllQuarters();
        });
        
        wrapper.querySelector('.btn-confirm-q').addEventListener('click', (e) => {
            const qNum = parseInt(e.target.dataset.q);
            if (confirmedQuarters.has(qNum)) {
                confirmedQuarters.delete(qNum);
            } else {
                confirmedQuarters.add(qNum);
            }
            isMatchSaved = false;
            renderAllQuarters();
        });

        wrapper.querySelector('.q-memo').addEventListener('input', (e) => {
            quarterMemos[q] = e.target.value;
            document.getElementById(`pitchMemoDisplay-${q}`).innerText = e.target.value ? `Q${q}: ${e.target.value}` : '';
        });
        
        renderQuarterPlayers(q);
    }
}

function getPosColorClass(role) {
    if (!role) return '';
    role = role.toUpperCase();
    if (['FW', 'WF', 'ST'].includes(role)) return 'fw-color';
    if (['CM', 'CDM', 'CAM', 'LM', 'RM'].includes(role)) return 'mf-color';
    if (['CB', 'WB', 'LB', 'RB'].includes(role)) return 'df-color';
    if (role === 'GK') return 'gk-color';
    return '';
}

function renderQuarterPlayers(q) {
    const pitch = document.getElementById(`formationSpots-${q}`);
    const bench = document.getElementById(`benchArea-${q}`);
    
    let activePlayerIds = (allocatedQuarters[q] || []).map(id => Number(id));
    let hasGk = false;
    
    // Pitch players
    activePlayerIds.forEach(pid => {
        let player = players.find(p => p.id === pid);
        if(!player) return;
        
        let pos = quarterPositions[q][pid];
        if (pos && pos.x >= 0) {
            let el = document.createElement('div');
            el.className = 'player-card';
            if (swapSource && swapSource.pid === pid && swapSource.q === q) el.classList.add('selected-swap');

            // Find role from formation matching coordinates
            let formation = formationTemplates[quarterFormations[q]];
            let spot = formation.find(s => s.x === pos.x && s.y === pos.y);
            let role = spot ? spot.role : (player.pos1 || 'none');
            let colorClass = getPosColorClass(role);

            if (role === 'GK') hasGk = true;
            
            el.innerHTML = `<div class="p-cd-circle ${colorClass}">${player.back_number || '?'}</div><span class="p-cd-name">${player.name}</span>`;
            el.style.left = `${pos.x}%`;
            el.style.top = `${pos.y}%`;
            
            el.addEventListener('click', () => handleSwapClick(pid, q, 'pitch'));
            pitch.appendChild(el);
        }
    });

    if(!hasGk && activePlayerIds.length > 0) {
        let marker = document.createElement('div');
        marker.className = 'player-card gk-marker';
        marker.innerHTML = `<div class="p-cd-circle gk-circle">GK</div><span class="p-cd-name">골키퍼</span>`;
        marker.style.left = '50%';
        marker.style.top = '92%';
        pitch.appendChild(marker);
    }
    
    // Bench players
    let attendingPlayers = Array.from(attendances).map(id => players.find(p=>p.id===id)).filter(p=>p);
    attendingPlayers.forEach(player => {
        if(!activePlayerIds.includes(player.id)) {
            let el = document.createElement('div');
            el.className = 'player-card';
            if (swapSource && swapSource.pid === player.id && swapSource.q === q) el.classList.add('selected-swap');

            let colorClass = getPosColorClass(player.pos1);
            el.innerHTML = `<div class="p-cd-circle ${colorClass}">${player.back_number || '?'}</div><span class="p-cd-name">${player.name}</span>`;
            el.style.position = 'relative'; 
            el.style.left = 'unset'; el.style.top = 'unset'; el.style.transform = 'unset';
            
            el.addEventListener('click', () => handleSwapClick(player.id, q, 'bench'));
            bench.appendChild(el);
        }
    });
}

function handleSwapClick(pid, q, type) {
    if (!swapSource) {
        swapSource = { pid, q, type };
        renderAllQuarters();
    } else {
        if (swapSource.q !== q) {
            swapSource = { pid, q, type }; // Changed quarter, reset source
            renderAllQuarters();
            return;
        }

        if (swapSource.pid === pid) {
            swapSource = null; // Canceled
            renderAllQuarters();
            return;
        }

        // Do Swap logic
        const qAlloc = allocatedQuarters[q];
        const sourcePid = swapSource.pid;
        const targetPid = pid;

        if (swapSource.type === 'pitch' && type === 'pitch') {
            // Swap positions on pitch
            let tempPos = quarterPositions[q][sourcePid];
            quarterPositions[q][sourcePid] = quarterPositions[q][targetPid];
            quarterPositions[q][targetPid] = tempPos;
        } 
        else if (swapSource.type === 'pitch' && type === 'bench') {
            // Pitch player goes to bench, Bench player goes to pitch position
            let pitchPos = quarterPositions[q][sourcePid];
            quarterPositions[q][sourcePid] = {x: -1, y: -1};
            quarterPositions[q][targetPid] = pitchPos;
            // Swap in allocated array
            let sIdx = qAlloc.indexOf(sourcePid);
            qAlloc[sIdx] = targetPid;
        }
        else if (swapSource.type === 'bench' && type === 'pitch') {
            // Source is bench, Target is pitch
            let pitchPos = quarterPositions[q][targetPid];
            quarterPositions[q][targetPid] = {x: -1, y: -1};
            quarterPositions[q][sourcePid] = pitchPos;
            // Swap in allocated array
            let tIdx = qAlloc.indexOf(targetPid);
            qAlloc[tIdx] = sourcePid;
        }
        // Bench to Bench swap doesn't matter for data except visuals maybe

        swapSource = null;
        renderAllQuarters();
    }
}

async function fetchStats() {
    const res = await fetch(`${API_BASE}/stats`);
    const dbStats = await res.json();
    
    let localStats = {};
    if (!isMatchSaved) {
        confirmedQuarters.forEach(q => {
            let pids = allocatedQuarters[q] || [];
            pids.forEach(pid => {
                pid = Number(pid);
                if (!localStats[pid]) localStats[pid] = { quarters: 0 };
                localStats[pid].quarters += 1;
            });
        });
    }

    let finalStats = players.map(p => {
        let dbS = dbStats.find(s => s.id === p.id);
        let matchDays = dbS ? dbS.match_days : 0;
        let quarters = dbS ? dbS.quarters : 0;
        
        let localQ = localStats[p.id] ? localStats[p.id].quarters : 0;
        quarters += localQ;

        return {
            id: p.id,
            name: p.name,
            back_number: p.back_number,
            match_days: matchDays + (localQ > 0 ? 1 : 0),
            quarters: quarters
        };
    }).filter(s => s.quarters > 0);

    finalStats.sort((a, b) => b.quarters - a.quarters);

    const tbody = document.getElementById('statsBody');
    tbody.innerHTML = '';
    finalStats.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight: 600;">${s.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${s.back_number ? `No.${s.back_number}` : ''}</div>
            </td>
            <td>${s.match_days}회</td>
            <td>${s.quarters}쿼터 (${s.quarters * 25}분)</td>
            <td style="text-align:center;">
                <button class="btn-delete-stats" data-id="${s.id}" style="background:transparent; border:none; cursor:pointer; color:#ef4444; font-size:1.2rem;" title="기록 삭제">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-delete-stats').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const pid = e.target.closest('button').dataset.id;
            if(confirm('이 선수의 모든 경기 기록을 삭제하시겠습니까? (선수 정보는 유지됩니다)')) {
                await fetch(`${API_BASE}/players/${pid}/stats`, { method: 'DELETE' });
                fetchStats();
            }
        });
    });
}
