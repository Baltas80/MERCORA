ORDER_TRANSITIONS={"pending_payment":{"cancelled"},"payment_confirmed":{"processing"},"processing":{"shipped"},"shipped":{"delivered"},"delivered":{"completed"},"disputed":{"cancelled","completed"}}
TERMINAL={"cancelled","completed","refunded"}
def can_transition(current:str,target:str)->bool:
    if current in TERMINAL:return False
    return target==current or target in ORDER_TRANSITIONS.get(current,set())
