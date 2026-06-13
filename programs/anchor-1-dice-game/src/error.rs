use anchor_lang::prelude::*;

#[error_code]
pub enum DiceError {

    #[msg("Bump error")]
    BumpError,

    #[msg("Overflow")]
    Overflow,

    #[msg("Minimum bet is 0.01 Sol")]
    MinimumBet,

    #[msg("Maximum bet exceeded")]
    MaximumBet,

    #[msg("Minimum roll is 2")]
    MinimumRoll,

    #[msg("Maximum roll is 96")]
    MaximumRoll,

    #[msg("Timeout yet not reached")]
    TimeoutNotReached,

    #[msg("Introspected instruction must target this program")]
    InvalidIntrospectedProgram,

    #[msg("Introspected instruction is not a SubmitRoll instruction")]
    InvalidIntrospectedInstruction,

    #[msg("SubmitRoll instruction must be signed by the house")]
    InvalidRollSigner,

    #[msg("SubmitRoll instruction does not reference this bet")]
    BetMismatch,

    #[msg("Roll value must be between 1 and 100")]
    InvalidRollValue,
}
