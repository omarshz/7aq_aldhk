use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    content: String,
}

/// Send a chat-completions request and return the assistant's text content.
///
/// Errors are returned as short, category-tagged strings so the TypeScript
/// `toFriendlyError` helper can map them to user-visible messages.
async fn send_chat_request(url: &str, request: &ChatRequest) -> Result<String, String> {
    let client = reqwest::Client::new();

    let response = client
        .post(url)
        .json(request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                format!("connection refused: could not reach LLM endpoint ({e})")
            } else if e.is_timeout() {
                format!("timeout: LLM request timed out after 30 s ({e})")
            } else {
                format!("network error: LLM request failed ({e})")
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let _body = response.text().await.unwrap_or_default();
        return Err(format!(
            "connection error: LLM returned HTTP {status}"
        ));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("json parse error: failed to decode LLM response ({e})"))?;

    let content = chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .unwrap_or_else(|| {
            "MOOD: confused\nCOMMENT: I couldn't think of anything to say!".to_string()
        });

    Ok(content)
}

#[tauri::command]
pub async fn query_llm(
    endpoint: String,
    model: String,
    screenshot_b64: String,
) -> Result<String, String> {
    let system_message = ChatMessage {
        role: "system".to_string(),
        content: serde_json::Value::String(
            "You are a small desktop companion named Dubly. Give a brief, witty \
             one-sentence comment about what you see on the user's screen. \
             You should be playful, curious, and sometimes sarcastic but always friendly. \
             Format your response exactly as:\n\
             MOOD: <mood>\n\
             COMMENT: <comment>\n\n\
             Valid moods: happy, surprised, sad, angry, neutral, confused"
                .to_string(),
        ),
    };

    let user_content = serde_json::json!([
        {
            "type": "text",
            "text": "What do you see on my screen right now? Give a brief comment."
        },
        {
            "type": "image_url",
            "image_url": {
                "url": format!("data:image/jpeg;base64,{}", screenshot_b64)
            }
        }
    ]);

    let user_message = ChatMessage {
        role: "user".to_string(),
        content: user_content,
    };

    let request = ChatRequest {
        model,
        messages: vec![system_message, user_message],
        max_tokens: 100,
        temperature: 0.8,
    };

    let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));
    send_chat_request(&url, &request).await
}

#[tauri::command]
pub async fn query_llm_chat(
    endpoint: String,
    model: String,
    user_message: String,
) -> Result<String, String> {
    let system_message = ChatMessage {
        role: "system".to_string(),
        content: serde_json::Value::String(
            "You are a small desktop companion named Dubly. The user is chatting with you directly. \
             Be playful, curious, and sometimes sarcastic but always friendly. \
             Keep responses to 1-2 sentences. \
             Format your response exactly as:\n\
             MOOD: <mood>\n\
             COMMENT: <comment>\n\n\
             Valid moods: happy, surprised, sad, angry, neutral, confused"
                .to_string(),
        ),
    };

    let msg = ChatMessage {
        role: "user".to_string(),
        content: serde_json::Value::String(user_message),
    };

    let request = ChatRequest {
        model,
        messages: vec![system_message, msg],
        max_tokens: 150,
        temperature: 0.8,
    };

    let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));
    send_chat_request(&url, &request).await
}
