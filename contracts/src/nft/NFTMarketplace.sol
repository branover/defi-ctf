// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function balanceOf(address owner) external view returns (uint256);
    function getTokensOfOwner(address owner) external view returns (uint256[] memory);
    function totalSupply() external view returns (uint256);
    function rarityScore(uint256 tokenId) external view returns (uint8);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title NFTMarketplace
/// @notice Fixed-price NFT marketplace accepting WETH as payment.
///         Sellers list tokens at a WETH price; buyers pay via ERC-20 approval.
contract NFTMarketplace {
    // ── Types ─────────────────────────────────────────────────────────────────

    struct Listing {
        address seller;
        uint256 price;  // in WETH (18 decimals)
        bool    active;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    IERC721 public immutable collection;
    IERC20  public immutable weth;

    mapping(uint256 => Listing) public listings;

    // Track all listed tokenIds for enumeration
    uint256[] private _listedTokenIds;
    mapping(uint256 => uint256) private _listingIndex; // tokenId → index in _listedTokenIds

    // ── Events ────────────────────────────────────────────────────────────────

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _collection, address _weth) {
        collection = IERC721(_collection);
        weth       = IERC20(_weth);
    }

    // ── Seller actions ────────────────────────────────────────────────────────

    /// @notice List a token at the given WETH price.
    ///         Caller must own the token and have approved this marketplace.
    function listToken(uint256 tokenId, uint256 price) external {
        require(price > 0, "NFTMarketplace: price must be > 0");
        require(collection.ownerOf(tokenId) == msg.sender, "NFTMarketplace: not owner");
        require(
            collection.getApproved(tokenId) == address(this) ||
            collection.isApprovedForAll(msg.sender, address(this)),
            "NFTMarketplace: marketplace not approved"
        );

        if (listings[tokenId].active) {
            // Update price in place
            listings[tokenId].price = price;
            listings[tokenId].seller = msg.sender;
        } else {
            listings[tokenId] = Listing({ seller: msg.sender, price: price, active: true });
            _listingIndex[tokenId] = _listedTokenIds.length;
            _listedTokenIds.push(tokenId);
        }

        emit Listed(tokenId, msg.sender, price);
    }

    /// @notice Cancel an active listing.
    function cancelListing(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.active, "NFTMarketplace: not listed");
        require(l.seller == msg.sender, "NFTMarketplace: not seller");

        l.active = false;
        _removeListing(tokenId);

        emit Cancelled(tokenId, msg.sender);
    }

    // ── Buyer actions ─────────────────────────────────────────────────────────

    /// @notice Buy a listed token. Buyer must have approved this marketplace to
    ///         spend at least `price` WETH.
    function buyToken(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.active, "NFTMarketplace: not listed");
        address seller = l.seller;
        uint256 price  = l.price;

        // Deactivate first (re-entrancy guard)
        l.active = false;
        _removeListing(tokenId);

        // Transfer WETH from buyer to seller
        require(
            weth.transferFrom(msg.sender, seller, price),
            "NFTMarketplace: WETH transfer failed"
        );

        // Transfer NFT from seller to buyer
        collection.transferFrom(seller, msg.sender, tokenId);

        emit Sold(tokenId, seller, msg.sender, price);
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// @notice Returns all active listings as (tokenId, seller, price) tuples.
    function getListings() external view returns (
        uint256[] memory tokenIds,
        address[] memory sellers,
        uint256[] memory prices
    ) {
        uint256 n = _listedTokenIds.length;
        tokenIds = new uint256[](n);
        sellers  = new address[](n);
        prices   = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 tid = _listedTokenIds[i];
            tokenIds[i] = tid;
            sellers[i]  = listings[tid].seller;
            prices[i]   = listings[tid].price;
        }
    }

    /// @notice Returns the lowest active listing price, or 0 if no listings.
    function floorPrice() external view returns (uint256 floor) {
        floor = type(uint256).max;
        bool found;
        for (uint256 i = 0; i < _listedTokenIds.length; i++) {
            uint256 tid = _listedTokenIds[i];
            if (listings[tid].active && listings[tid].price < floor) {
                floor = listings[tid].price;
                found = true;
            }
        }
        if (!found) floor = 0;
    }

    /// @notice Returns all tokenIds owned by `_owner`.
    function getPlayerNFTs(address _owner) external view returns (uint256[] memory) {
        return collection.getTokensOfOwner(_owner);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _removeListing(uint256 tokenId) internal {
        uint256 idx  = _listingIndex[tokenId];
        uint256 last = _listedTokenIds.length - 1;
        if (idx != last) {
            uint256 lastToken  = _listedTokenIds[last];
            _listedTokenIds[idx] = lastToken;
            _listingIndex[lastToken] = idx;
        }
        _listedTokenIds.pop();
        delete _listingIndex[tokenId];
    }
}
