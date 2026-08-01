//! How busy the machine is.
//!
//! **Load average, not "CPU percent".** A percentage needs two samples and a decision about the
//! interval between them; the load average is what the kernel already keeps, it is what every Unix
//! tool reports, and it is what somebody watching a build actually wants to know — whether the
//! machine is saturated, not what one instant looked like.
//!
//! **No new dependency.** `sysinfo` would bring a whole platform-abstraction crate for three numbers
//! the C library already has (rule:dependencies: the standard library or an existing dependency
//! first). `libc` is already in the tree, transitively, and `getloadavg` is POSIX.

use serde::Serialize;

/// The three numbers `uptime` prints: load over one, five and fifteen minutes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SystemLoad {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
    /// How many logical cores there are, so a caller can say whether that load is a lot.
    ///
    /// A load of 8 is idle on a 16-core machine and desperate on a 4-core one. Sending the number
    /// with it is what lets the interface colour it honestly instead of guessing a threshold.
    pub cores: usize,
}

/// Read the load average, or `None` where the platform has no such thing.
///
/// Windows has no load average at all — it is not a smaller number there, it does not exist — so the
/// honest answer is nothing, and the caller shows nothing rather than a zero that looks like an idle
/// machine (rule:cross-platform).
#[cfg(unix)]
pub fn read() -> Option<SystemLoad> {
    let mut values = [0f64; 3];
    // SAFETY: `getloadavg` writes at most `nelem` doubles into the array it is given; the array is
    // exactly three long and three is what is asked for.
    let filled = unsafe { libc::getloadavg(values.as_mut_ptr(), 3) };
    if filled != 3 {
        // Documented to return -1 when it cannot obtain the load. Reported as absent rather than as
        // zeroes, which would read as a perfectly idle machine.
        return None;
    }
    Some(SystemLoad {
        one: values[0],
        five: values[1],
        fifteen: values[2],
        cores: cores(),
    })
}

#[cfg(not(unix))]
pub fn read() -> Option<SystemLoad> {
    // Windows keeps no load average. A processor-time counter is a different measurement with
    // different semantics, and pretending it is the same number would make the display a lie on one
    // platform (rule:cross-platform: a feature that cannot exist is absent, not faked).
    None
}

/// Logical cores, falling back to 1 so a caller never divides by zero.
fn cores() -> usize {
    std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_machine_reports_a_load() {
        // On any Unix this must answer; the test runs on one.
        let load = read().expect("a Unix always has a load average");
        assert!(load.one >= 0.0, "load cannot be negative, got {}", load.one);
        assert!(load.cores >= 1);
    }

    #[test]
    fn the_three_windows_are_all_present() {
        let load = read().expect("load");
        // All three are real numbers — a NaN would render as "NaN" in the status bar.
        for value in [load.one, load.five, load.fifteen] {
            assert!(value.is_finite(), "got {value}");
        }
    }

    #[test]
    fn the_core_count_is_the_machine_s() {
        let load = read().expect("load");
        assert_eq!(
            load.cores,
            std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get)
        );
    }
}
