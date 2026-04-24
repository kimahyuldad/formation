import psycopg2
import psycopg2.extras
import json
import os
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ.get("DATABASE_URL")

def get_db():
    conn = psycopg2.connect(DB_URL)
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS players (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE,
            pos1 TEXT,
            pos2 TEXT,
            is_core INTEGER DEFAULT 0,
            back_number TEXT DEFAULT '',
            team_name TEXT DEFAULT '쌍팔클럽'
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS matches (
            id SERIAL PRIMARY KEY,
            name TEXT,
            date_str TEXT,
            lineup_data TEXT,
            opponent TEXT DEFAULT '',
            result TEXT DEFAULT '',
            memo TEXT DEFAULT '',
            team_name TEXT DEFAULT '쌍팔클럽'
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS saved_formations (
            id SERIAL PRIMARY KEY,
            label TEXT,
            formation_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            team_name TEXT DEFAULT '쌍팔클럽'
        )
    ''')
    conn.commit() # Commit table creations first
    
    # Add new columns to existing tables if they don't exist
    for col, default in [('opponent', "''"), ('result', "''"), ('memo', "''")]:
        try:
            c.execute(f"ALTER TABLE matches ADD COLUMN {col} TEXT DEFAULT {default}")
            conn.commit()
        except psycopg2.Error:
            conn.rollback()
            
    for table in ['players', 'matches', 'saved_formations']:
        try:
            c.execute(f"ALTER TABLE {table} ADD COLUMN team_name TEXT DEFAULT '쌍팔클럽'")
            conn.commit()
        except psycopg2.Error:
            conn.rollback()
            
    c.close()
    conn.close()

def fetch_players(team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT * FROM players WHERE team_name=%s ORDER BY name', (team_name,))
    rows = c.fetchall()
    c.close()
    conn.close()
    return [dict(r) for r in rows]

def get_player(p_id):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT * FROM players WHERE id=%s', (p_id,))
    row = c.fetchone()
    c.close()
    conn.close()
    return dict(row) if row else None

def add_player(data, team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor()
    try:
        # Note: name + team_name combination should ideally be unique, but for now we keep UNIQUE on name overall or just let it fail if same name exists. 
        # Actually, let's remove UNIQUE on name from schema in the future, but for now just try inserting.
        c.execute('''
            INSERT INTO players (name, pos1, pos2, is_core, back_number, team_name)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        ''', (data.get('name'), data.get('pos1'), data.get('pos2'), data.get('is_core', 0), data.get('back_number', ''), team_name))
        player_id = c.fetchone()[0]
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        player_id = None
    finally:
        c.close()
        conn.close()
    return player_id

def update_player(p_id, data):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        UPDATE players
        SET name=%s, pos1=%s, pos2=%s, is_core=%s, back_number=%s
        WHERE id=%s
    ''', (data.get('name'), data.get('pos1'), data.get('pos2'), data.get('is_core'), data.get('back_number'), p_id))
    conn.commit()
    c.close()
    conn.close()

def delete_player(p_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM players WHERE id=%s', (p_id,))
    conn.commit()
    c.close()
    conn.close()

def delete_player_stats(p_id):
    """선수의 통계 기록만 삭제 (경기 데이터에서 해당 선수 제거, 선수 정보는 유지)"""
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT id, lineup_data FROM matches')
    rows = c.fetchall()
    
    update_cursor = conn.cursor()
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
                update_cursor.execute('UPDATE matches SET lineup_data=%s WHERE id=%s', (json.dumps(data), row['id']))
        except Exception:
            pass
    conn.commit()
    c.close()
    update_cursor.close()
    conn.close()

def save_match(name, date_str, lineup_data, opponent='', result='', memo='', team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        INSERT INTO matches (name, date_str, lineup_data, opponent, result, memo, team_name)
        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
    ''', (name, date_str, json.dumps(lineup_data), opponent, result, memo, team_name))
    match_id = c.fetchone()[0]
    conn.commit()
    c.close()
    conn.close()
    return match_id

def update_match(match_id, name, date_str, lineup_data, opponent='', result='', memo=''):
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        UPDATE matches SET name=%s, date_str=%s, lineup_data=%s, opponent=%s, result=%s, memo=%s
        WHERE id=%s
    ''', (name, date_str, json.dumps(lineup_data), opponent, result, memo, match_id))
    conn.commit()
    c.close()
    conn.close()

def update_match_result_memo(match_id, result, memo):
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE matches SET result=%s, memo=%s WHERE id=%s', (result, memo, match_id))
    conn.commit()
    c.close()
    conn.close()

def fetch_matches(team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT id, name, date_str, opponent, result, memo FROM matches WHERE team_name=%s ORDER BY id DESC', (team_name,))
    rows = c.fetchall()
    c.close()
    conn.close()
    return [dict(r) for r in rows]

def fetch_all_matches(team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT * FROM matches WHERE team_name=%s ORDER BY id DESC', (team_name,))
    rows = c.fetchall()
    c.close()
    conn.close()
    ret = []
    for row in rows:
        d = dict(row)
        d['lineup_data'] = json.loads(d['lineup_data'])
        ret.append(d)
    return ret

def get_match(m_id):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT * FROM matches WHERE id=%s', (m_id,))
    row = c.fetchone()
    c.close()
    conn.close()
    if row:
        d = dict(row)
        d['lineup_data'] = json.loads(d['lineup_data'])
        return d
    return None

def delete_match(m_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM matches WHERE id=%s', (m_id,))
    conn.commit()
    c.close()
    conn.close()

# -------- Saved Formations --------

def fetch_saved_formations(team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    c.execute('SELECT * FROM saved_formations WHERE team_name=%s ORDER BY id DESC', (team_name,))
    rows = c.fetchall()
    c.close()
    conn.close()
    ret = []
    for row in rows:
        d = dict(row)
        d['formation_data'] = json.loads(d['formation_data'])
        ret.append(d)
    return ret

def save_formation(label, formation_data, team_name='쌍팔클럽'):
    conn = get_db()
    c = conn.cursor()
    c.execute('INSERT INTO saved_formations (label, formation_data, team_name) VALUES (%s, %s, %s) RETURNING id',
              (label, json.dumps(formation_data), team_name))
    fid = c.fetchone()[0]
    conn.commit()
    c.close()
    conn.close()
    return fid

def delete_saved_formation(fid):
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM saved_formations WHERE id=%s', (fid,))
    conn.commit()
    c.close()
    conn.close()

