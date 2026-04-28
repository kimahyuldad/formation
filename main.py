from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os

import database
import logic

app = FastAPI(title="Quarterly Smart Lineup Builder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Database
database.init_db()

class PlayerModel(BaseModel):
    name: str
    pos1: str
    pos2: str
    is_core: int
    back_number: str
    team_name: str = '쌍팔클럽'

class LineupRequestModel(BaseModel):
    attendance_ids: List[int]
    core_ids: List[int]

class SaveMatchModel(BaseModel):
    name: str
    date_str: str
    lineup_data: dict
    opponent: Optional[str] = ''
    result: Optional[str] = ''
    memo: Optional[str] = ''
    team_name: str = '쌍팔클럽'

class PatchMatchModel(BaseModel):
    result: Optional[str] = ''
    memo: Optional[str] = ''

class SaveFormationModel(BaseModel):
    label: str
    formation_data: Dict[str, Any]
    team_name: str = '쌍팔클럽'

@app.get("/api/players")
def read_players(team: str = '쌍팔클럽'):
    return database.fetch_players(team)

@app.post("/api/players")
def create_player(player: PlayerModel):
    pid = database.add_player(player.dict(), player.team_name)
    if pid is None:
        return {"error": "Failed to add player (maybe duplicate name)"}
    return {"id": pid}

@app.put("/api/players/{player_id}")
def edit_player(player_id: int, player: PlayerModel):
    database.update_player(player_id, player.dict())
    return {"id": player_id}

@app.delete("/api/players/{player_id}")
def remove_player(player_id: int):
    database.delete_player(player_id)
    return {"status": "ok"}

@app.delete("/api/players/{player_id}/stats")
def remove_player_stats(player_id: int):
    """선수 정보는 유지하되 통계 기록만 모든 경기에서 삭제"""
    database.delete_player_stats(player_id)
    return {"status": "ok"}

@app.post("/api/distribute")
def distribute_quarters(req: LineupRequestModel, team: str = '쌍팔클럽'):
    all_players = database.fetch_players(team)
    gk_ids = [p['id'] for p in all_players if p['pos1'] == 'GK' or p['pos2'] == 'GK']
    allocations = logic.distribute_quarters(req.attendance_ids, req.core_ids, gk_ids)
    return allocations

@app.get("/api/matches")
def read_matches(team: str = '쌍팔클럽'):
    return database.fetch_all_matches(team)

@app.get("/api/stats")
def read_stats(team: str = '쌍팔클럽'):
    matches = database.fetch_all_matches(team)
    players = database.fetch_players(team)

    stats = {}
    for p in players:
        stats[p['id']] = {
            'id': p['id'],
            'name': p['name'],
            'back_number': p['back_number'],
            'match_days': 0,
            'quarters': 0
        }

    for m in matches:
        allocations = m['lineup_data'].get('allocations', {})
        attended_players = set()
        for q, pids in allocations.items():
            for pid in pids:
                pid = int(pid)
                if pid in stats:
                    stats[pid]['quarters'] += 1
                    attended_players.add(pid)
        for pid in attended_players:
            stats[pid]['match_days'] += 1

    return list(stats.values())

@app.post("/api/matches")
def create_match(match: SaveMatchModel):
    mid = database.save_match(
        match.name, match.date_str, match.lineup_data,
        match.opponent, match.result, match.memo, match.team_name
    )
    return {"id": mid}

@app.put("/api/matches/{match_id}")
def update_match(match_id: int, match: SaveMatchModel):
    database.update_match(
        match_id, match.name, match.date_str, match.lineup_data,
        match.opponent, match.result, match.memo
    )
    return {"id": match_id}

@app.patch("/api/matches/{match_id}")
def patch_match(match_id: int, data: PatchMatchModel):
    database.update_match_result_memo(match_id, data.result, data.memo)
    return {"id": match_id}

@app.delete("/api/matches/{match_id}")
def remove_match(match_id: int):
    database.delete_match(match_id)
    return {"status": "ok"}

@app.get("/api/matches/{match_id}")
def read_match(match_id: int):
    return database.get_match(match_id)

# -------- Saved Formations API --------

@app.get("/api/formations/saved")
def list_saved_formations(team: str = '쌍팔클럽'):
    return database.fetch_saved_formations(team)

@app.post("/api/formations/saved")
def create_saved_formation(data: SaveFormationModel):
    fid = database.save_formation(data.label, data.formation_data, data.team_name)
    return {"id": fid}

@app.delete("/api/formations/saved/{fid}")
def remove_saved_formation(fid: int):
    database.delete_saved_formation(fid)
    return {"status": "ok"}

# Ensure static dir exists
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    index_path = os.path.join(static_dir, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return f.read()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
