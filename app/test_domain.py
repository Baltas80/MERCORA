from uuid import uuid4

from domain import Account, AccountRole, Listing, ListingStatus, can_manage_listing


def test_seller_can_manage_own_listing():
    account_id = uuid4()
    account = Account(account_id, "seller-1", AccountRole.SELLER)
    listing = Listing(uuid4(), account_id, "Item", ListingStatus.DRAFT, 1)
    assert can_manage_listing(account, listing)


def test_seller_cannot_manage_other_seller_listing():
    account = Account(uuid4(), "seller-1", AccountRole.SELLER)
    listing = Listing(uuid4(), uuid4(), "Item", ListingStatus.DRAFT, 1)
    assert not can_manage_listing(account, listing)


def test_moderator_can_manage_listing():
    account = Account(uuid4(), "mod-1", AccountRole.MODERATOR)
    listing = Listing(uuid4(), uuid4(), "Item", ListingStatus.ACTIVE, 1)
    assert can_manage_listing(account, listing)
