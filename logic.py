import random

def distribute_quarters(attendance_ids, core_ids, gk_ids=None):
    if gk_ids is None:
        gk_ids = []
        
    # 1. Strict preparation: ensure everything is integer
    try:
        pids = sorted(list(set([int(x) for x in attendance_ids])))
        cores = sorted(list(set([int(x) for x in core_ids])))
        
        gks = sorted(list(set([p for p in pids if p in gk_ids])))
        outfield_pids = [p for p in pids if p not in gks]
        outfield_cores = [p for p in cores if p in outfield_pids]
        normals = [p for p in outfield_pids if p not in outfield_cores]
    except:
        # Failsafe for empty input
        return {1:[], 2:[], 3:[], 4:[]}
    
    if not pids: return {1:[], 2:[], 3:[], 4:[]}
    
    q_lineups = {1: [], 2: [], 3: [], 4: []}
    
    # 골키퍼는 무조건 4쿼터 모두 할당
    for q in [1, 2, 3, 4]:
        for gk in gks:
            q_lineups[q].append(gk)
            
    # 필드 플레이어가 없으면 골키퍼만 반환
    if not outfield_pids:
        return q_lineups

    total_target = 40 # 10 field + 1 GK (fixed spot), so we distribute 40 outfield slots
    quotas = {p: 0 for p in outfield_pids}
    total_allocated = 0

    # Step A: Give 2 to everyone (Safety baseline)
    for p in outfield_pids:
        if total_allocated < total_target:
            quotas[p] = 2
            total_allocated += 2

    # Step B: Core players to 3 or 4
    for p in outfield_cores:
        while quotas[p] < 3 and total_allocated < total_target:
            quotas[p] += 1
            total_allocated += 1

    # Step C: Normals to 3 (Balanced)
    shuffled_normals = list(normals)
    random.shuffle(shuffled_normals)
    for p in shuffled_normals:
        if quotas[p] < 3 and total_allocated < total_target:
            quotas[p] += 1
            total_allocated += 1

    # Step D: Fill remaining to Cores then Normals up to 4
    for p in outfield_cores + shuffled_normals:
        if total_allocated < total_target and quotas[p] < 4:
            quotas[p] += 1
            total_allocated += 1

    # 2. Assignment Phase: Round-Robin distribution to keep players dispersed
    q_cap = {1: 10, 2: 10, 3: 10, 4: 10}
    p_to_qs = {p: [] for p in outfield_pids}
    
    # Sort by quota DESC to satisfy most constrained players first
    sorted_players = sorted(outfield_pids, key=lambda p: quotas[p], reverse=True)
    
    for p in sorted_players:
        for _ in range(quotas[p]):
            # Try to place in a quarter where player is not yet present
            possible_qs = [q for q in [1,2,3,4] if q not in p_to_qs[p] and q_cap[q] > 0]
            # Prioritize quarters that are most empty
            valid_qs = sorted(possible_qs, key=lambda q: q_cap[q], reverse=True)
            if valid_qs:
                target_q = valid_qs[0]
                q_lineups[target_q].append(p)
                q_cap[target_q] -= 1
                p_to_qs[p].append(target_q)

    return q_lineups
