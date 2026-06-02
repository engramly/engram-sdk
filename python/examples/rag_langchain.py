"""RAG: parse pages → split → embed → query.

Demonstrates EngramLoader plugging straight into LangChain.

Install:
    pip install "engramly[langchain]" langchain-text-splitters langchain-openai langchain-community faiss-cpu
"""

from engramly.langchain import EngramLoader


def main() -> None:
    urls = [
        "https://en.wikipedia.org/wiki/Engram_(neuropsychology)",
        "https://en.wikipedia.org/wiki/Memory",
    ]
    docs = EngramLoader(urls).load()
    for doc in docs:
        print(f"[{doc.metadata['title']}] saved {doc.metadata['tokens_saved']} tokens")
        print(doc.page_content[:200], "...\n")

    # Then plug into your favorite splitter + vector store:
    #
    # from langchain_text_splitters import RecursiveCharacterTextSplitter
    # from langchain_openai import OpenAIEmbeddings
    # from langchain_community.vectorstores import FAISS
    #
    # chunks = RecursiveCharacterTextSplitter(chunk_size=800).split_documents(docs)
    # store = FAISS.from_documents(chunks, OpenAIEmbeddings())
    # print(store.similarity_search("what is an engram?")[0].page_content)


if __name__ == "__main__":
    main()
