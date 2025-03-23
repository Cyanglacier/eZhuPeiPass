// 这是一个补丁文件，包含background.js的关键修改部分

// 1. 替换queryAI函数
async function queryAI(questions, apiKey) {
  if (!apiKey) {
    throw new Error('API密钥未设置');
  }

  return new Promise((resolve, reject) => {
    const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
    const https = require('https');
    const urlObj = new URL(url);
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
      // 移除异步标志，使用同步模式
      // 'X-DashScope-Async': 'enable'
    };
    
    const data = {
      'model': 'qwen-turbo',
      'input': {
        'messages': [
          {
            'role': 'system',
            'content': '你是一个医学专家，精通中医学和西医学。'
          },
          {
            'role': 'user',
            'content': buildPrompt(questions)
          }
        ]
      },
      'parameters': {
        'result_format': 'message'
      }
    };

    console.log('[Background] 发送API请求:', {
      url,
      headers,
      data: JSON.stringify(data)
    });

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: headers,
      timeout: 60000  // 60秒超时
    };

    let timer = setTimeout(() => {
      console.error('[Background] API请求超时');
      reject(new Error('API调用超时'));
    }, 60000);

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        clearTimeout(timer);
        timer = null;
        
        console.log('[Background] 收到API响应:', {
          status: res.statusCode,
          headers: res.headers
        });
        
        if (res.statusCode !== 200) {
          console.error('[Background] API错误响应:', responseData);
          reject(new Error(`API调用失败: ${res.statusCode} - ${responseData}`));
          return;
        }
        
        try {
          const result = JSON.parse(responseData);
          console.log('[Background] API响应数据:', result);
          
          if (!result.output || !result.output.choices || !result.output.choices[0] || !result.output.choices[0].message) {
            reject(new Error('API返回数据格式错误'));
            return;
          }
          
          resolve(result.output.choices[0].message.content);
        } catch (error) {
          console.error('[Background] 解析API响应数据异常:', error);
          reject(new Error('解析API响应数据异常'));
        }
      });
    });
    
    req.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      console.error('[Background] API调用网络错误:', error);
      reject(new Error(`API网络错误: ${error.message}`));
    });
    
    // 写入请求数据
    req.write(JSON.stringify(data));
    req.end();
  });
}

// 2. 替换parseAIResponse函数
function parseAIResponse(response) {
  console.log('原始AI响应内容:', response);
  const answers = [];
  // 尝试多种格式匹配
  let patterns = [
    /答案[：:]\s*([A-Z,]+)/g,
    /选择\s*([A-Z,]+)/g,
    /正确答案[是为：:]\s*([A-Z,]+)/g,
    /答案是\s*([A-Z,]+)/g,
    /选项\s*([A-Z,]+)\s*是正确的/g
  ];
  
  let matched = false;
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(response)) !== null) {
      matched = true;
      // 处理可能的逗号分隔格式
      if (match[1].includes(',')) {
        const options = match[1].split(',').map(opt => opt.trim());
        answers.push(options.join(''));
      } else {
        answers.push(match[1]);
      }
    }
    
    if (matched) break;
  }
  
  // 如果没有匹配到任何答案，尝试直接提取 A/B/C/D
  if (!matched) {
    // 查找单独出现的 A、B、C、D
    const simpleRegex = /\b([A-D])\b/g;
    while ((match = simpleRegex.exec(response)) !== null) {
      answers.push(match[1]);
    }
  }
  
  if(answers.length === 0) {
    console.error('未能解析到答案，原始响应:', response);
  }
  return answers;
}

// 3. 替换checkAPIStatus函数
async function checkAPIStatus(apiKey) {
  return new Promise((resolve) => {
    try {
      const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
      const https = require('https');
      const urlObj = new URL(url);
      
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };
      
      const data = {
        'model': 'qwen-turbo',
        'input': {
          'messages': [
            {
              'role': 'system',
              'content': '你好'
            },
            {
              'role': 'user',
              'content': '测试连接'
            }
          ]
        },
        'parameters': {
          'result_format': 'message'
        }
      };
  
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers,
        timeout: 15000 // 15秒超时
      };
  
      let timer = setTimeout(() => {
        console.error('[Background] API状态检查超时');
        resolve({ 
          success: false, 
          error: 'API连接超时' 
        });
      }, 15000);
  
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          clearTimeout(timer);
          timer = null;
          
          if (res.statusCode !== 200) {
            console.error('[Background] API状态检查失败:', responseData);
            resolve({ 
              success: false, 
              error: `API服务状态检查失败: ${res.statusCode}` 
            });
            return;
          }
          
          resolve({ success: true });
        });
      });
      
      req.on('error', (error) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        console.error('[Background] API状态检查网络错误:', error);
        resolve({ 
          success: false, 
          error: `API网络错误: ${error.message}` 
        });
      });
      
      // 写入请求数据
      req.write(JSON.stringify(data));
      req.end();
    } catch (error) {
      console.error('[Background] API状态检查异常:', error);
      resolve({ 
        success: false, 
        error: error.message || 'API服务可能不可用' 
      });
    }
  });
} 