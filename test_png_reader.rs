use png::Decoder;
use std::io::BufReader;
use std::fs;

fn main() {
    let file = fs::File::open("Mia Nakamura - The Working Girl.png").unwrap();
    let decoder = Decoder::new(BufReader::new(file));
    let reader = decoder.read_info().unwrap();
    let info = reader.info();
    
    println!("Latin1 text chunks: {}", info.uncompressed_latin1_text.len());
    for chunk in &info.uncompressed_latin1_text {
        println!("  Keyword: '{}', Text length: {}", chunk.keyword, chunk.text.len());
    }
    
    println!("UTF-8 text chunks: {}", info.utf8_text.len());
    for chunk in &info.utf8_text {
        println!("  Keyword: '{}'", chunk.keyword);
    }
    
    println!("Compressed latin1 text chunks: {}", info.compressed_latin1_text.len());
}
