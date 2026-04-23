import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'lineup.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            pos1 TEXT,
            pos2 TEXT,
            is_core INTEGER DEFAULT 0,
            back_number TEXT DEFAULT ''
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            date_str TEXT,
            lineup_data TEXT,
            opponent TEXT DEFAULT '',
            result TEXT DEFAULT '',
            memo TEXT DEFAULT ''
        )
    ''')
    # 기존 DB에 컬럼이 없을 경우 안전하게 추가
    for col, default in [('opponent', "''"), ('result', "''"), ('memo', "''")]:
        try:
            c.execute(f"ALTER TABLE matches ADD COLUMN {col} TEXT DEFAULT {default}")
        except Exception:
            pass
    conn.commit()
    conn.close()

def fetch_players():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM players ORDER BY name')
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_player(p_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM players WHERE id=?', (p_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def add_player(data):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute('''
            INSERT INTO players (name, pos1, pos2, is_core, back_number)
            VALUES (?, ?, ?, ?, ?)
        ''', (data.get('name'), data.get('pos1'), data.get('pos2'), data.get('is_core', 0), data.get('back_number', '')))
        player_id = c.lastrowid
        conn.commit()
    except sqlite3.IntegrityError:
        player_id = None
    finally:
        conn.close()
    return player_id

def update_player(p_id, data):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        UPDATE players
        SET name=?, pos1=?, pos2=?, is_core=?, back_number=?
        WHERE id=?
    ''', (data.get('name'), data.get('pos1'), data.get('pos2'), data.get('is_core'), data.get('back_number'), p_id))
    conn.commit()
    conn.close()

def delete_player(p_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM players WHERE id=?', (p_id,))
    conn.commit()
    conn.close()

def delete_player_stats(p_id):
    """선수의 통계 기록만 삭제 (경기 데이터에서 해당 선수 제거, 선수 정보는 유지)"""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, lineup_data FROM matches')
    rows = c.fetchall()
    for row in rows:
        try:
            data = json.loads(row['lineup_data'])
            allocs = data.get('allocations', {})
            changed = False
            for q, pids in allocs.items():
                new_pids = [pid for pid in pids if int(pid) != int(p_id)]
                if len(new_pids) != len(pids):
                    allocs[q] = new_pids
                    changed = True
            if changed:
                data['allocations'] = allocs
                c.execute('UPDATE matches SET lineup_data=? WHERE id=?', (json.dumps(data), row['id']))
        except Exception:
            pass
    conn.commit()
    conn.close()

def save_match(name, date_str, lineup_data, opponent='', result='', memo=''):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        INSERT INTO matches (name, date_str, lineup_data, opponent, result, memo)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (name, date_str, json.dumps(lineup_data), opponent, result, memo))
    match_id = c.lastrowid
    conn.commit()
    conn.close()
    return match_id

def update_match(match_id, name, date_str, lineup_data, opponent='', result='', memo=''):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        UPDATE matches SET name=?, date_str=?, lineup_data=?, opponent=?, result=?, memo=?
        WHERE id=?
    ''', (name, date_str, json.dumps(lineup_data), opponent, result, memo, match_id))
    conn.commit()
    conn.close()

def update_match_result_memo(match_id, result, memo):
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE matches SET result=?, memo=? WHERE id=?', (result, memo, match_id))
    conn.commit()
    conn.close()

def fetch_matches():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, name, date_str, opponent, result, memo FROM matches ORDER BY id DESC')
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def fetch_all_matches():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM matches ORDER BY id DESC')
    rows = c.fetchall()
    conn.close()
    ret = []
    for row in rows:
        d = dict(row)
        d['lineup_data'] = json.loads(d['lineup_data'])
        ret.append(d)
    return ret

def get_match(m_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM matches WHERE id=?', (m_id,))
    row = c.fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['lineup_data'] = json.loads(d['lineup_data'])
        return d
    return None
