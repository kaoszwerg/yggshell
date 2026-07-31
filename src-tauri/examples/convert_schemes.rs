//! One-off: turn downloaded `.itermcolors` files into the `.yggtheme` files we ship.
//!
//! Uses OUR reader and OUR writer, so the shipped files are proof that the two agree — and any
//! colour our reader mishandles would show up here rather than in front of a user.
use std::path::Path;
use yggshell_lib::theme;

fn main() {
    let mut args = std::env::args().skip(1);
    let from = args.next().expect("source directory");
    let to = args.next().expect("target directory");

    let mut written = 0;
    let mut entries: Vec<_> = std::fs::read_dir(&from)
        .expect("read source")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "itermcolors"))
        .collect();
    entries.sort();

    for path in entries {
        let parsed = theme::import(&path).expect("import");
        let out = Path::new(&to).join(format!("{}.yggtheme", parsed.id));
        std::fs::write(&out, theme::itermcolors::write(&parsed)).expect("write");
        let defined = parsed.ansi.iter().filter(|c| c.is_some()).count();
        println!(
            "{:<20} {:>2}/16 ansi  -> {}",
            parsed.name,
            defined,
            out.display()
        );
        written += 1;
    }
    println!("{written} schemes converted");
}
