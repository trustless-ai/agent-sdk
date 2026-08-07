#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod erc8004;
pub mod erc8203;
pub mod erc8263;
pub mod erc8274;
pub mod erc8275;
pub mod erc8281;
pub mod erc8299;

pub mod erc8301;
pub mod erc8312;
pub mod erc8323;
pub mod r#trait;
pub use r#trait::DataProvider;
