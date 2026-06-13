use anchor_lang::prelude::*;

pub const HOUSE_EDGE_BASIS_POINTS: u16 = 150;
pub const MIN_BET_LAMPORTS: u64 = 10_000_000;
pub const MIN_ROLL: u8 = 1;
pub const MAX_ROLL: u8 = 99;

#[account]
#[derive(InitSpace)]
pub struct Bet {
    pub player: Pubkey,
    pub seed: u128,
    pub slot: u64,
    pub amount: u64,
    pub roll: u8,
    pub bump: u8,
}