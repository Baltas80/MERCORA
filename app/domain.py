from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class AccountRole(StrEnum):
    BUYER = "buyer"
    SELLER = "seller"
    MODERATOR = "moderator"
    ADMIN = "admin"


class ListingStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    SOLD = "sold"
    REMOVED = "removed"


@dataclass(frozen=True)
class Account:
    id: UUID
    pseudonym: str
    role: AccountRole


@dataclass(frozen=True)
class Listing:
    id: UUID
    seller_id: UUID
    title: str
    status: ListingStatus
    quantity: int


def can_manage_listing(account: Account, listing: Listing) -> bool:
    if account.role in {AccountRole.MODERATOR, AccountRole.ADMIN}:
        return True
    return account.role == AccountRole.SELLER and account.id == listing.seller_id
