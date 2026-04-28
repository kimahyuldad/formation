const API_BASE = '/api';

let currentTeam = localStorage.getItem('lineup_team') || '쌍팔클럽';
let myTeams = JSON.parse(localStorage.getItem('my_teams')) || ['쌍팔클럽'];
if (!myTeams.includes(currentTeam)) { myTeams.push(currentTeam); }

// ▶ 구버전 localStorage 키 자동 마이그레이션 (최초 1회)
(function migrateOldLocalStorage() {
    const oldAtt = localStorage.getItem('lineup_attendances');
    const oldCores = localStorage.getItem('lineup_cores');
    const migrated = localStorage.getItem('ls_migrated_v2');
    if (!migrated) {
        if (oldAtt) localStorage.setItem('lineup_attendances_쌍팔클럽', oldAtt);
        if (oldCores) localStorage.setItem('lineup_cores_쌍팔클럽', oldCores);
        localStorage.setItem('ls_migrated_v2', '1');
    }
})();

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
    localStorage.setItem('lineup_attendances_' + currentTeam, JSON.stringify(Array.from(attendances)));
    localStorage.setItem('lineup_cores_' + currentTeam, JSON.stringify(Array.from(cores)));
}

function loadFromLocal() {
    attendances.clear();
    cores.clear();
    const savedAtt = localStorage.getItem('lineup_attendances_' + currentTeam);
    const savedCores = localStorage.getItem('lineup_cores_' + currentTeam);
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
    
    // Team UI Initialization
    const teamSel = document.getElementById('teamSelector');

    function renderTeamSelector() {
        teamSel.innerHTML = myTeams.map(t => `<option value="${t}" ${t === currentTeam ? 'selected' : ''}>${t}</option>`).join('');
    }

    function switchTeam(newTeam) {
        currentTeam = newTeam;
        localStorage.setItem('lineup_team', currentTeam);
        loadFromLocal();
        // 즉시 화면 초기화
        players = [];
        document.getElementById('playerList').innerHTML = '';
        updateAttendanceCounter();
        fetchPlayers();
        fetchMatches();
        fetchSavedFormations();
    }

    renderTeamSelector();

    teamSel.addEventListener('change', (e) => {
        switchTeam(e.target.value);
    });

    document.getElementById('btnAddTeam').addEventListener('click', () => {
        const newTeam = document.getElementById('newTeamInput').value.trim();
        if (!newTeam) return;
        if (!myTeams.includes(newTeam)) {
            myTeams.push(newTeam);
            localStorage.setItem('my_teams', JSON.stringify(myTeams));
        }
        document.getElementById('newTeamInput').value = '';
        renderTeamSelector();
        switchTeam(newTeam);
    });

    document.getElementById('btnDeleteTeam').addEventListener('click', () => {
        if (myTeams.length <= 1) return alert('마지막 팀은 삭제할 수 없습니다.');
        if (!confirm(`"${currentTeam}" 팀을 목록에서 삭제하시겠습니까?\n(서버의 선수 및 기록 데이터는 삭제되지 않습니다)`)) return;
        myTeams = myTeams.filter(t => t !== currentTeam);
        localStorage.setItem('my_teams', JSON.stringify(myTeams));
        renderTeamSelector();
        switchTeam(myTeams[0]);
    });

    fetchPlayers();
    fetchMatches();
    
    document.getElementById('addPlayerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const p = {
            name: document.getElementById('pName').value,
            pos1: document.getElementById('pPos1').value,
            pos2: document.getElementById('pPos2').value,
            is_core: 0,
            back_number: document.getElementById('pBackNumber').value,
            team_name: currentTeam
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
        try {
            const res = await fetch(`${API_BASE}/distribute?team=${encodeURIComponent(currentTeam)}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ attendance_ids: Array.from(attendances), core_ids: Array.from(cores) })
            });
            if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
            const rawResult = await res.json();
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
        } catch(e) {
            alert('쿼터 배분 중 오류 발생: ' + e.message);
            console.error('distribute error:', e);
        }
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
            },
            team_name: currentTeam
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

    // 포메이션 저장 버튼
    document.getElementById('btnSaveFormation').addEventListener('click', async () => {
        const label = document.getElementById('formationSaveName').value.trim();
        if (!label) return alert('저장 이름을 입력해주세요.');
        const formationData = {
            formations: quarterFormations,
            memos: quarterMemos,
            allocations: allocatedQuarters,
            positions: quarterPositions,
            confirmed: Array.from(confirmedQuarters)
        };
        await fetch(`${API_BASE}/formations/saved`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ label, formation_data: formationData, team_name: currentTeam })
        });
        document.getElementById('formationSaveName').value = '';
        alert(`"${label}" 포메이션이 저장되었습니다!`);
        fetchSavedFormations();
    });

    // 모달 닫기 이벤트
    document.getElementById('btnModalClose').addEventListener('click', () => {
        document.getElementById('matchBoardModal').style.display = 'none';
    });

    // 기록 저장 이벤트
    document.getElementById('btnSaveRecord')?.addEventListener('click', async () => {
        const matchId = document.getElementById('recordMatchSelect').value;
        if (!matchId) return alert('저장할 경기를 선택해주세요.');
        const result = document.getElementById('recordResultSelect').value;
        const memo = document.getElementById('recordMemoInput').value;
        
        await fetch(`${API_BASE}/matches/${matchId}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ result, memo })
        });
        alert('기록이 바로 저장되었습니다!');
        fetchMatches();
    });

    // 참석자 명단 전체 선택 해제 이벤트
    document.getElementById('btnDeselectAll')?.addEventListener('click', () => {
        if(attendances.size === 0) return;
        if(confirm('선택된 참석자 명단을 모두 초기화하시겠습니까?')) {
            attendances.clear();
            cores.clear();
            saveToLocal();
            renderPlayerList();
            updateAttendanceCounter();
        }
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
                fetchSavedFormations();
            } else if (e.target.dataset.target === 'statsView') {
                fetchStats();
            }
        });
    });
}

async function fetchPlayers() {
    const res = await fetch(`${API_BASE}/players?team=${encodeURIComponent(currentTeam)}`);
    players = await res.json();
    renderPlayerList();
    updateAttendanceCounter();
}

async function fetchMatches() {
    const res = await fetch(`${API_BASE}/matches?team=${encodeURIComponent(currentTeam)}`);
    const history = await res.json();
    
    // 기록 입력 셀렉트 박스 갱신
    const select = document.getElementById('recordMatchSelect');
    if (select) {
        select.innerHTML = history.map(h => `<option value="${h.id}">${h.date_str} vs ${h.opponent || '자체전'}</option>`).join('');
        select.onchange = () => {
            const m = history.find(x => x.id == select.value);
            document.getElementById('recordResultSelect').value = m ? (m.result || '') : '';
            document.getElementById('recordMemoInput').value = m ? (m.memo || '') : '';
        };
        // 초기값 설정
        if (history.length > 0) {
            select.dispatchEvent(new Event('change'));
        }
    }

    const recordList = document.getElementById('matchRecordList');
    if (recordList) {
        recordList.innerHTML = history.filter(h => h.result || h.memo).map((h, idx) => `
            <div style="display:flex; align-items:center; gap:8px; font-size:1rem; flex-wrap:wrap; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                <strong style="color:white; margin-right:5px;">${idx + 1}.</strong>
                <span style="font-weight:bold; color:white;">${h.date_str} vs ${h.opponent || '자체전'}</span>
                ${h.result ? `<span style="font-weight:bold; color:${h.result==='승'?'#3b82f6':h.result==='패'?'#ef4444':'#10b981'}; margin-left:5px;">${h.result}</span>` : ''}
                ${h.memo ? `<span style="color:#fbbf24; margin-left:5px;">${h.memo}</span>` : ''}
                <button class="btn-view-board" data-id="${h.id}" style="margin-left:auto; background:transparent; border:none; color:#a3e635; cursor:pointer; font-weight:bold;">작전판 보기</button>
                <button class="btn-delete-match" data-id="${h.id}" style="background:transparent; border:none; color:#ef4444; cursor:pointer; font-weight:bold;">삭제</button>
            </div>
        `).join('');

        document.querySelectorAll('.btn-view-board').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const matchId = e.target.dataset.id;
                const match = history.find(m => m.id == matchId);
                if(match) showMatchBoardModal(match);
            });
        });

        document.querySelectorAll('.btn-delete-match').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const matchId = e.target.dataset.id;
                if (confirm('이 경기 기록을 삭제하시겠습니까?\n(해당 경기의 통계 기록도 함께 삭제됩니다)')) {
                    await fetch(`${API_BASE}/matches/${matchId}`, { method: 'DELETE' });
                    fetchMatches();
                }
            });
        });
    }
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
            
            makeDraggable(el, q, pid, pitch);
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

function makeDraggable(el, q, pid, pitch) {
    let isDragging = false;
    let startX, startY;
    let startLeft, startTop;

    el.addEventListener('pointerdown', (e) => {
        // 좌클릭 또는 터치만 허용
        if (e.button !== undefined && e.button !== 0) return;
        
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseFloat(el.style.left) || 50;
        startTop = parseFloat(el.style.top) || 50;
        
        el.setPointerCapture(e.pointerId);

        function onPointerMove(ev) {
            let dx = ev.clientX - startX;
            let dy = ev.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                isDragging = true;
            }
            if (!isDragging) return;

            let rect = pitch.getBoundingClientRect();
            let newLeft = startLeft + (dx / rect.width) * 100;
            let newTop = startTop + (dy / rect.height) * 100;

            // 제한 (0 ~ 100%)
            newLeft = Math.max(0, Math.min(100, newLeft));
            newTop = Math.max(0, Math.min(100, newTop));

            el.style.left = newLeft + '%';
            el.style.top = newTop + '%';
        }

        function onPointerUp(ev) {
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', onPointerUp);
            el.removeEventListener('pointercancel', onPointerUp);
            el.releasePointerCapture(e.pointerId);

            if (isDragging) {
                // 드래그 종료 시 새로운 위치 저장
                quarterPositions[q][pid] = {
                    x: parseFloat(el.style.left),
                    y: parseFloat(el.style.top)
                };
                isMatchSaved = false;
            } else {
                // 드래그가 아니었으면 클릭으로 간주하여 교체 로직 실행
                handleSwapClick(pid, q, 'pitch');
            }
        }

        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);
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
    const res = await fetch(`${API_BASE}/stats?team=${encodeURIComponent(currentTeam)}`);
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

    finalStats.sort((a, b) => {
        if (b.match_days !== a.match_days) return b.match_days - a.match_days; // 1순위: 출전 일수
        return b.quarters - a.quarters; // 2순위: 쿼터 수
    });

    const grid = document.getElementById('statsGrid');
    grid.innerHTML = '';
    
    if (finalStats.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; color:var(--text-secondary);">통계 기록이 없습니다.</div>';
    }

    finalStats.forEach((s, idx) => {
        const rank = idx + 1;
        let rankClass = '';
        if (rank === 1) rankClass = 'stat-rank-1';
        else if (rank === 2) rankClass = 'stat-rank-2';
        else if (rank === 3) rankClass = 'stat-rank-3';

        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <div class="stat-rank ${rankClass}">${rank}</div>
            <div class="stat-info">
                <div class="stat-name">${s.name} <span style="font-size:0.75rem; color:var(--text-secondary);">${s.back_number ? `No.${s.back_number}` : ''}</span></div>
                <div class="stat-details">
                    <span style="color:var(--accent-color); font-weight:600;">출전 ${s.match_days}회</span> &middot; ${s.quarters}쿼터 (${s.quarters * 25}분)
                </div>
            </div>
            <div class="stat-actions">
                <button class="btn-delete-stats" data-id="${s.id}" style="background:transparent; border:none; cursor:pointer; color:#ef4444; font-size:1.2rem;" title="기록 삭제">🗑️</button>
            </div>
        `;
        grid.appendChild(card);
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

    // 일괄 삭제 버튼 이벤트
    const btnDeleteAll = document.getElementById('btnDeleteAllStats');
    if (btnDeleteAll) {
        btnDeleteAll.onclick = async () => {
            if (finalStats.length === 0) return alert('삭제할 기록이 없습니다.');
            if (confirm(`모든 선수(${finalStats.length}명)의 통계 기록을 일괄 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                for (const s of finalStats) {
                    await fetch(`${API_BASE}/players/${s.id}/stats`, { method: 'DELETE' });
                }
                alert('모든 통계 기록이 삭제되었습니다.');
                fetchStats();
            }
        };
    }
}

// -------- Saved Formations --------

async function fetchSavedFormations() {
    const res = await fetch(`${API_BASE}/formations/saved?team=${encodeURIComponent(currentTeam)}`);
    const list = await res.json();
    const container = document.getElementById('savedFormationList');
    if (!container) return;
    
    if (list.length === 0) {
        container.innerHTML = '<div class="saved-formation-empty">저장된 포메이션이 없습니다.</div>';
        return;
    }

    container.innerHTML = list.map(f => `
        <div class="saved-formation-item" data-id="${f.id}">
            <div class="saved-formation-info">
                <span class="saved-formation-label">${f.label}</span>
                <span class="saved-formation-date">${f.created_at || ''}</span>
            </div>
            <div class="saved-formation-actions">
                <button class="btn-load-formation" data-id="${f.id}">📂 불러오기</button>
                <button class="btn-del-formation" data-id="${f.id}">🗑️</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.btn-load-formation').forEach(btn => {
        btn.addEventListener('click', () => {
            const fid = parseInt(btn.dataset.id);
            const found = list.find(f => f.id === fid);
            if (!found) return;
            loadSavedFormation(found.formation_data);
        });
    });

    container.querySelectorAll('.btn-del-formation').forEach(btn => {
        btn.addEventListener('click', async () => {
            const fid = btn.dataset.id;
            if (confirm('이 포메이션을 삭제하시겠습니까?')) {
                await fetch(`${API_BASE}/formations/saved/${fid}`, { method: 'DELETE' });
                fetchSavedFormations();
            }
        });
    });
}

function loadSavedFormation(data) {
    if (data.formations) {
        for (const [q, f] of Object.entries(data.formations)) {
            quarterFormations[Number(q)] = f;
            // 명단 관리탭 포메이션 드롭다운도 동기화
            const pf = document.getElementById(`preForm${q}`);
            if (pf) pf.value = f;
        }
    }
    if (data.memos) {
        for (const [q, m] of Object.entries(data.memos)) {
            quarterMemos[Number(q)] = m;
        }
    }
    if (data.allocations) {
        allocatedQuarters = { 1: [], 2: [], 3: [], 4: [] };
        for (const [q, ids] of Object.entries(data.allocations)) {
            allocatedQuarters[Number(q)] = ids.map(id => Number(id));
        }
    }
    if (data.positions) {
        quarterPositions = { 1: {}, 2: {}, 3: {}, 4: {} };
        for (const [q, posMap] of Object.entries(data.positions)) {
            quarterPositions[Number(q)] = {};
            for (const [pid, pos] of Object.entries(posMap)) {
                quarterPositions[Number(q)][Number(pid)] = pos;
            }
        }
    }
    if (data.confirmed) {
        confirmedQuarters = new Set(data.confirmed.map(Number));
    }
    alert('포메이션을 불러왔습니다!');
    renderAllQuarters();
}

function showMatchBoardModal(match) {
    const modal = document.getElementById('matchBoardModal');
    const title = document.getElementById('modalMatchTitle');
    const captureArea = document.getElementById('modalCaptureArea');

    title.innerText = `${match.date_str} vs ${match.opponent || '자체전'} 작전판`;
    captureArea.innerHTML = '';

    const lData = match.lineup_data;
    if(!lData || !lData.allocations) {
        captureArea.innerHTML = '<div style="color:var(--text-secondary); text-align:center;">기록된 작전판 데이터가 없습니다.</div>';
        modal.style.display = 'flex';
        return;
    }

    // confirmed된 쿼터만 표시
    const confirmed = lData.confirmed || [1, 2, 3, 4];
    
    // Sort confirmed quarters
    const sortedQ = [...confirmed].sort((a,b) => a-b);

    sortedQ.forEach(q => {
        const qForm = lData.formations ? lData.formations[q] : '4231';
        const qMemo = lData.memos ? lData.memos[q] : '';
        const qPids = lData.allocations[q] || [];
        const qPos = lData.positions ? lData.positions[q] : {};

        let wrapper = document.createElement('div');
        wrapper.className = 'quarter-wrapper';
        wrapper.innerHTML = `
            <div class="q-header">
                <h3 style="margin:0; font-size:1.1rem; color:var(--accent-color);">${q}쿼터 (${qForm})</h3>
            </div>
            <div class="pitch-container" style="flex-grow:0; aspect-ratio:2/3; height:auto; min-height:400px; margin-bottom:0;">
                <div class="pitch-memo">${qMemo ? `Q${q}: ${qMemo}` : ''}</div>
                <div class="pitch">
                    <div class="pitch-center-circle"></div>
                    <div class="pitch-center-line"></div>
                    <div class="pitch-box-top"></div>
                    <div class="pitch-box-bottom"></div>
                    <div id="modalPitch-${q}" style="width:100%; height:100%; position:absolute; top:0; left:0;"></div>
                </div>
            </div>
        `;
        captureArea.appendChild(wrapper);

        const pitch = wrapper.querySelector(`#modalPitch-${q}`);
        let hasGk = false;

        qPids.forEach(pid => {
            pid = Number(pid);
            const player = players.find(p => p.id === pid);
            if(!player) return;

            const pos = qPos[pid];
            if(pos && pos.x >= 0) {
                let el = document.createElement('div');
                el.className = 'player-card';
                // Find role to get color
                let formation = formationTemplates[qForm];
                let spot = formation ? formation.find(s => s.x === pos.x && s.y === pos.y) : null;
                let role = spot ? spot.role : (player.pos1 || 'none');
                let colorClass = getPosColorClass(role);

                if (role === 'GK') hasGk = true;

                el.innerHTML = `<div class="p-cd-circle ${colorClass}">${player.back_number || '?'}</div><span class="p-cd-name">${player.name}</span>`;
                el.style.left = `${pos.x}%`;
                el.style.top = `${pos.y}%`;
                el.style.cursor = 'default';
                pitch.appendChild(el);
            }
        });

        if(!hasGk && qPids.length > 0) {
            let marker = document.createElement('div');
            marker.className = 'player-card gk-marker';
            marker.innerHTML = `<div class="p-cd-circle gk-circle">GK</div><span class="p-cd-name">골키퍼</span>`;
            marker.style.left = '50%';
            marker.style.top = '92%';
            marker.style.cursor = 'default';
            pitch.appendChild(marker);
        }
    });

    modal.style.display = 'flex';
}
