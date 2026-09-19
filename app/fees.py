from dataclasses import dataclass
BPS_DENOMINATOR = 10_000
@dataclass(frozen=True)
class FeePolicy:
    version: int
    buyer_fee_bps: int
    seller_fee_bps: int
    def __post_init__(self):
        if self.version <= 0 or not 0 <= self.buyer_fee_bps <= BPS_DENOMINATOR or not 0 <= self.seller_fee_bps <= BPS_DENOMINATOR:
            raise ValueError("invalid_fee_policy")
        if self.buyer_fee_bps + self.seller_fee_bps > BPS_DENOMINATOR:
            raise ValueError("combined_fee_too_high")
def calculate_percentage_fee(base_minor: int, fee_bps: int) -> int:
    if base_minor < 0 or not 0 <= fee_bps <= BPS_DENOMINATOR:
        raise ValueError("invalid_fee")
    return (base_minor * fee_bps + BPS_DENOMINATOR - 1) // BPS_DENOMINATOR
