export async function jflapSimilarityParser(filePath: string): Promise<void> {
  try {
    if (!filePath.toLowerCase().endsWith(".jff")) {
      throw new Error("Expected a file path ending with .jff extension");
    }

    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const fileContents = await response.text();
    console.log(`Contents of ${filePath}:`);
    console.log(fileContents);
  } catch (error) {
    console.error("Failed to read JFLAP file:", error);
  }
}
